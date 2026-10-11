-- Bid Arena V1: 完整基础 schema
-- 约定：所有时间均为 epoch 毫秒（BIGINT），避免时区歧义；所有金额均为整数积分（BIGINT）。

CREATE TABLE users (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(190)  NOT NULL,
    password_hash VARCHAR(100)  NOT NULL,
    display_name  VARCHAR(64)   NOT NULL,
    role          VARCHAR(16)   NOT NULL DEFAULT 'USER',   -- ADMIN | USER | AGENT
    status        VARCHAR(16)   NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | DISABLED
    created_at    BIGINT        NOT NULL,
    updated_at    BIGINT        NOT NULL,
    UNIQUE KEY uk_users_email (email),
    CONSTRAINT chk_users_role CHECK (role IN ('ADMIN','USER','AGENT')),
    CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE','DISABLED'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE sessions (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64)     NOT NULL, -- sha256(token) hex，明文 token 不落库
    user_id    BIGINT       NOT NULL,
    expires_at BIGINT       NOT NULL,
    created_at BIGINT       NOT NULL,
    UNIQUE KEY uk_sessions_token (token_hash),
    KEY idx_sessions_user (user_id),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE wallets (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    balance    BIGINT NOT NULL DEFAULT 1000, -- 总余额
    frozen     BIGINT NOT NULL DEFAULT 0,    -- 冻结金额
    version    BIGINT NOT NULL DEFAULT 0,    -- 乐观版本（并发观察用；写路径以行锁为准）
    updated_at BIGINT NOT NULL,
    UNIQUE KEY uk_wallets_user (user_id),
    CONSTRAINT chk_wallets_nonneg CHECK (balance >= 0 AND frozen >= 0 AND frozen <= balance),
    CONSTRAINT fk_wallets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE auctions (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    title              VARCHAR(128) NOT NULL,
    description        VARCHAR(512) NULL,
    status             VARCHAR(16)  NOT NULL DEFAULT 'DRAFT', -- DRAFT|RUNNING|SETTLING|FINISHED|CANCELLED
    start_price        BIGINT       NOT NULL DEFAULT 100,
    min_increment      BIGINT       NOT NULL DEFAULT 10,
    current_price      BIGINT       NOT NULL,
    current_leader_id  BIGINT       NULL,
    duration_seconds   INT          NOT NULL DEFAULT 180,
    started_at         BIGINT       NULL,
    end_time           BIGINT       NULL, -- epoch millis；RUNNING 时非空
    extend_count       INT          NOT NULL DEFAULT 0,
    max_extends        INT          NOT NULL DEFAULT 3,
    seq                BIGINT       NOT NULL DEFAULT 0, -- 单场事件序号，单调递增
    settle_reason      VARCHAR(32)  NULL, -- EXPIRED | CANCELLED
    created_by         BIGINT       NOT NULL,
    created_at         BIGINT       NOT NULL,
    updated_at         BIGINT       NOT NULL,
    KEY idx_auctions_status_end (status, end_time),
    CONSTRAINT chk_auctions_price CHECK (start_price > 0 AND min_increment > 0 AND current_price >= start_price),
    CONSTRAINT chk_auctions_status CHECK (status IN ('DRAFT','RUNNING','SETTLING','FINISHED','CANCELLED')),
    CONSTRAINT chk_auctions_extends CHECK (extend_count >= 0 AND extend_count <= max_extends)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE auction_participants (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    auction_id       BIGINT      NOT NULL,
    user_id          BIGINT      NOT NULL,
    participant_type VARCHAR(16) NOT NULL DEFAULT 'HUMAN', -- HUMAN | AGENT
    joined_at        BIGINT      NOT NULL,
    UNIQUE KEY uk_participants (auction_id, user_id),
    CONSTRAINT fk_participants_auction FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE,
    CONSTRAINT fk_participants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 单用户单场拍卖的冻结持仓（释放/扣款的精确依据）
CREATE TABLE wallet_holds (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    auction_id BIGINT NOT NULL,
    amount     BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    UNIQUE KEY uk_holds_user_auction (user_id, auction_id),
    CONSTRAINT chk_holds_nonneg CHECK (amount >= 0),
    CONSTRAINT fk_holds_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_holds_auction FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 资金流水：可完整解释 冻结/释放/扣款/退款 的每一笔变化
CREATE TABLE wallet_ledger (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT      NOT NULL,
    auction_id    BIGINT      NULL,
    request_id    VARCHAR(64) NULL,
    type          VARCHAR(16) NOT NULL, -- FREEZE | UNFREEZE | PAY | REFUND | GRANT
    amount        BIGINT      NOT NULL, -- 正负号表示方向
    balance_after BIGINT      NOT NULL,
    frozen_after  BIGINT      NOT NULL,
    remark        VARCHAR(255) NULL,
    created_at    BIGINT      NOT NULL,
    KEY idx_ledger_user_time (user_id, created_at),
    KEY idx_ledger_auction (auction_id),
    CONSTRAINT chk_ledger_type CHECK (type IN ('FREEZE','UNFREEZE','PAY','REFUND','GRANT')),
    CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE bids (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    auction_id BIGINT      NOT NULL,
    user_id    BIGINT      NOT NULL,
    amount     BIGINT      NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    seq        BIGINT      NOT NULL, -- 与 auction_events 对应的服务端序号
    created_at BIGINT      NOT NULL, -- 服务端接收/持久化时间（epoch ms）
    UNIQUE KEY uk_bids_user_request (user_id, request_id),
    KEY idx_bids_auction (auction_id, id),
    CONSTRAINT chk_bids_amount CHECK (amount > 0),
    CONSTRAINT fk_bids_auction FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE,
    CONSTRAINT fk_bids_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 成交结果：一场拍卖最多一条（主键即 auction_id，数据库级唯一结算保护）
CREATE TABLE auction_results (
    auction_id  BIGINT      NOT NULL PRIMARY KEY,
    winner_id   BIGINT      NULL,
    final_price BIGINT      NOT NULL,
    reason      VARCHAR(32) NOT NULL, -- EXPIRED（含无赢家流拍）| CANCELLED
    settled_at  BIGINT      NOT NULL,
    created_at  BIGINT      NOT NULL,
    CONSTRAINT chk_results_reason CHECK (reason IN ('EXPIRED','CANCELLED')),
    CONSTRAINT fk_results_auction FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE,
    CONSTRAINT fk_results_winner FOREIGN KEY (winner_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Agent Token：只存摘要，明文仅创建时返回一次
CREATE TABLE agent_tokens (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_hash        CHAR(64)    NOT NULL, -- sha256(token) hex
    token_prefix      VARCHAR(12) NOT NULL, -- 明文前 8 位，便于人工识别（非敏感）
    user_id           BIGINT      NOT NULL,
    auction_id        BIGINT      NOT NULL, -- 允许参与的拍卖范围（单场）
    scopes            VARCHAR(64) NOT NULL, -- 逗号分隔：auction:read,auction:bid
    expires_at        BIGINT      NOT NULL,
    revoked           TINYINT(1)  NOT NULL DEFAULT 0,
    rate_limit_per_min INT        NOT NULL DEFAULT 30,
    request_count     INT         NOT NULL DEFAULT 0,
    window_started_at BIGINT      NOT NULL DEFAULT 0,
    last_used_at      BIGINT      NULL,
    created_at        BIGINT      NOT NULL,
    UNIQUE KEY uk_agent_tokens_hash (token_hash),
    KEY idx_agent_tokens_user (user_id),
    CONSTRAINT fk_agent_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_agent_tokens_auction FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 已提交业务事件（事务内写入；事务提交后由 WebSocket 广播，断线客户端可凭 seq 对账）
CREATE TABLE auction_events (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    auction_id BIGINT      NOT NULL,
    seq        BIGINT      NOT NULL,
    type       VARCHAR(32) NOT NULL,
    payload    TEXT        NOT NULL, -- JSON
    created_at BIGINT      NOT NULL,
    UNIQUE KEY uk_events_seq (auction_id, seq),
    KEY idx_events_auction (auction_id),
    CONSTRAINT fk_events_auction FOREIGN KEY (auction_id) REFERENCES auctions (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
