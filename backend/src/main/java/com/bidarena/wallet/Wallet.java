package com.bidarena.wallet;

/**
 * 钱包行（balance=总余额，frozen=冻结，可用=balance-frozen）。
 */
public class Wallet {
    private long userId;
    private long balance;
    private long frozen;
    private long version;
    private long updatedAt;

    public long getUserId() {
        return userId;
    }

    public void setUserId(long userId) {
        this.userId = userId;
    }

    public long getBalance() {
        return balance;
    }

    public void setBalance(long balance) {
        this.balance = balance;
    }

    public long getFrozen() {
        return frozen;
    }

    public void setFrozen(long frozen) {
        this.frozen = frozen;
    }

    public long getVersion() {
        return version;
    }

    public void setVersion(long version) {
        this.version = version;
    }

    public long getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(long updatedAt) {
        this.updatedAt = updatedAt;
    }

    public long available() {
        return balance - frozen;
    }
}
