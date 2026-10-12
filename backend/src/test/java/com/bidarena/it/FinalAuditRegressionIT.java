package com.bidarena.it;

import com.bidarena.auction.*;
import com.bidarena.auction.dto.CreateAuctionRequest;
import com.bidarena.bid.BidOutcome;
import com.bidarena.bid.BidService;
import com.bidarena.common.BusinessException;
import com.bidarena.common.ErrorCode;
import com.bidarena.settlement.SettlementService;
import org.junit.jupiter.api.*;
import org.noear.solon.Solon;
import org.noear.solon.data.sql.SqlUtils;

import javax.sql.DataSource;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

/** Real MySQL tests. Each test owns new users/auctions; no seed wallet reset or database deletion. */
public class FinalAuditRegressionIT extends ItBase {
    SqlUtils sql;
    DataSource ds;
    AuctionService auctions;
    BidService bids;
    SettlementService settlements;
    long admin;

    @BeforeEach
    void services() throws Exception {
        assertTrue(System.getenv("BID_DB_URL").contains("bid_arena_codex_"),
                "Run these mutation tests only on a dedicated bid_arena_codex_* schema");
        sql = Solon.context().getBean(SqlUtils.class);
        ds = Solon.context().getBean(DataSource.class);
        auctions = Solon.context().getBean(AuctionService.class);
        bids = Solon.context().getBean(BidService.class);
        settlements = Solon.context().getBean(SettlementService.class);
        admin = value("SELECT id FROM users WHERE email='admin@example.com'");
    }

    long value(String statement, Object... args) throws Exception {
        Number n = sql.sql(statement, args).queryValue();
        return n == null ? 0 : n.longValue();
    }

    long user() throws Exception {
        long now = ts();
        long id = ((Number) sql.sql("INSERT INTO users(email,password_hash,display_name,role,status,created_at,updated_at) VALUES (?,'unused','Audit user','USER','ACTIVE',?,?)",
                "audit-" + UUID.randomUUID() + "@example.com", now, now).updateReturnKey()).longValue();
        sql.sql("INSERT INTO wallets(user_id,balance,frozen,updated_at) VALUES (?,10000,0,?)", id, now).update();
        return id;
    }

    long auction(boolean running) {
        CreateAuctionRequest req = new CreateAuctionRequest();
        req.setTitle("CODEX-TEST-" + UUID.randomUUID());
        long id = auctions.create(admin, req);
        if (running) auctions.start(id);
        return id;
    }

    void invariant() throws Exception {
        assertEquals(0, value("SELECT COUNT(*) FROM wallets WHERE balance<0 OR frozen<0 OR frozen>balance"));
        assertEquals(0, value("SELECT COUNT(*) FROM wallets w WHERE w.frozen <> (SELECT COALESCE(SUM(h.amount),0) FROM wallet_holds h WHERE h.user_id=w.user_id)"));
    }

    long[] state(long aid, long uid) throws Exception {
        return new long[] {
            value("SELECT current_price FROM auctions WHERE id=?", aid),
            value("SELECT seq FROM auctions WHERE id=?", aid),
            value("SELECT frozen FROM wallets WHERE user_id=?", uid),
            value("SELECT balance FROM wallets WHERE user_id=?", uid),
            value("SELECT COUNT(*) FROM bids WHERE auction_id=?", aid),
            value("SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=?", aid),
            value("SELECT COUNT(*) FROM auction_events WHERE auction_id=?", aid)
        };
    }

    @Test void requestIdCannotReplayAnotherAuction() throws Exception {
        long u=user(), a=auction(true), b=auction(true);
        String key=UUID.randomUUID().toString();
        bids.placeBid(a,u,key,110,ts());
        long[] before=state(b,u);
        BusinessException e=assertThrows(BusinessException.class,()->bids.placeBid(b,u,key,110,ts()));
        assertEquals(ErrorCode.IDEMPOTENT_CONFLICT,e.getErrorCode());
        assertArrayEquals(before,state(b,u));
        invariant();
    }

    @Test void requestIdAmountConflictAndLostResponseReplay() throws Exception {
        long u=user(), a=auction(true); String key=UUID.randomUUID().toString();
        BidOutcome first=bids.placeBid(a,u,key,110,ts());
        long[] before=state(a,u);
        BidOutcome replay=bids.placeBid(a,u,key,110,ts());
        assertTrue(replay.isIdempotentReplay()); assertEquals(first.getBidId(),replay.getBidId());
        assertArrayEquals(before,state(a,u));
        assertEquals(ErrorCode.IDEMPOTENT_CONFLICT,assertThrows(BusinessException.class,
                ()->bids.placeBid(a,u,key,120,ts())).getErrorCode());
        assertArrayEquals(before,state(a,u));
    }

    @Test void cancelledAuctionHasCancelledStateAndReleasesFunds() throws Exception {
        long u=user(), a=auction(true); bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts());
        auctions.cancel(a);
        assertEquals(Auction.CANCELLED,auctions.detail(a).getStatus());
        assertEquals(0,value("SELECT frozen FROM wallets WHERE user_id=?",u));
        assertEquals(0,value("SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=? AND type='PAY'",a));
        assertEquals(1,value("SELECT COUNT(*) FROM auction_results WHERE auction_id=? AND reason='CANCELLED'",a));
        assertThrows(BusinessException.class,()->auctions.cancel(a));
        invariant();
    }

    @Test void joinEventPreservesEnvelopeType() throws Exception {
        long u=user(), a=auction(true); auctions.join(a,u,false);
        String payload=sql.sql("SELECT payload FROM auction_events WHERE auction_id=? AND type='PARTICIPANT_JOINED'",a).queryValue();
        assertTrue(payload.contains("\"type\":\"PARTICIPANT_JOINED\""),payload);
        assertTrue(payload.contains("\"participantType\":\"HUMAN\""),payload);
    }

    @Test void listIncludesLeaderAndResult() throws Exception {
        long u=user(), a=auction(true); bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts());
        sql.sql("UPDATE auctions SET end_time=? WHERE id=?",ts()-1,a).update();
        settlements.tryClaim(a,ts()); settlements.finalizeSettlement(a);
        var summary=auctions.list().stream().filter(x->x.getId()==a).findFirst().orElseThrow();
        assertEquals("Audit user",summary.getCurrentLeaderName());
        assertNotNull(summary.getResult()); assertEquals(u,summary.getResult().getWinnerId());
    }

    @Test void defaultAuctionIsDraft180Seconds() {
        var a=auctions.detail(auction(false));
        assertEquals(Auction.DRAFT,a.getStatus()); assertEquals(180,a.getDurationSeconds());
        assertEquals(100,a.getCurrentPrice()); assertEquals(10,a.getMinIncrement()); assertNull(a.getEndTime());
    }

    @Test void equalDeadlineRejectedAndThreeExtensionsOnly() throws Exception {
        long u=user(), a=auction(true);
        long end=ts()+60000;
        sql.sql("UPDATE auctions SET end_time=? WHERE id=?",end,a).update();
        long[] before=state(a,u);
        final long deadline=end;
        assertEquals(ErrorCode.BID_TOO_LATE,assertThrows(BusinessException.class,
                ()->bids.placeBid(a,u,UUID.randomUUID().toString(),110,deadline)).getErrorCode());
        assertArrayEquals(before,state(a,u));
        for(int i=0;i<4;i++) {
            var outcome=bids.placeBid(a,u,UUID.randomUUID().toString(),110+i*10,end-5000);
            assertEquals(i<3,outcome.isExtended());
            if(i<3) end+=10000;
            assertEquals(end,auctions.detail(a).getEndTime());
        }
        assertEquals(3,auctions.detail(a).getExtendCount()); invariant();
    }

    @Test void fundsDeltaOldLeaderAndRejectionRollback() throws Exception {
        long u=user(), v=user(), a=auction(true);
        bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts());
        bids.placeBid(a,u,UUID.randomUUID().toString(),130,ts());
        assertEquals(130,value("SELECT frozen FROM wallets WHERE user_id=?",u));
        assertEquals(20,value("SELECT amount FROM wallet_ledger WHERE user_id=? AND auction_id=? AND type='FREEZE' ORDER BY id DESC LIMIT 1",u,a));
        long[] before=state(a,u);
        assertEquals(ErrorCode.INSUFFICIENT_FUNDS,assertThrows(BusinessException.class,
                ()->bids.placeBid(a,v,UUID.randomUUID().toString(),10001,ts())).getErrorCode());
        assertArrayEquals(before,state(a,u));
        bids.placeBid(a,v,UUID.randomUUID().toString(),150,ts());
        assertEquals(0,value("SELECT frozen FROM wallets WHERE user_id=?",u));
        assertEquals(150,value("SELECT frozen FROM wallets WHERE user_id=?",v)); invariant();
    }

    @Test void sqlFailureAfterWalletWritesRollsBackEverything() throws Exception {
        long u=user(), a=auction(true); long[] before=state(a,u);
        sql.sql("CREATE TRIGGER codex_fail_bid BEFORE INSERT ON bids FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CODEX intentional bid failure'").update();
        try {
            assertThrows(Exception.class,()->bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts()));
            assertArrayEquals(before,state(a,u)); invariant();
        } finally { sql.sql("DROP TRIGGER codex_fail_bid").update(); }
    }

    @Test void twoConcurrentUsersHaveSingleLeaderAndConcurrentRetrySingleEffect() throws Exception {
        long u=user(), v=user(), a=auction(true);
        ExecutorService pool=Executors.newFixedThreadPool(8);
        try {
            CyclicBarrier gate=new CyclicBarrier(2);
            List<Future<Boolean>> first=new ArrayList<>();
            for(long uid:new long[]{u,v}) first.add(pool.submit(()->{gate.await();try {bids.placeBid(a,uid,UUID.randomUUID().toString(),110,ts());return true;}catch(BusinessException e){assertEquals(ErrorCode.BID_TOO_LOW,e.getErrorCode());return false;}}));
            int successes=0; for(var f:first) if(f.get(10,TimeUnit.SECONDS))successes++;
            assertEquals(1,successes);
            long leader=auctions.detail(a).getCurrentLeaderId();
            String key=UUID.randomUUID().toString(); CyclicBarrier retries=new CyclicBarrier(8);
            List<Future<BidOutcome>> calls=new ArrayList<>();
            for(int i=0;i<8;i++)calls.add(pool.submit(()->{retries.await();return bids.placeBid(a,leader,key,120,ts());}));
            int fresh=0; for(var f:calls) if(!f.get(15,TimeUnit.SECONDS).isIdempotentReplay())fresh++;
            assertEquals(1,fresh); assertEquals(1,value("SELECT COUNT(*) FROM bids WHERE user_id=? AND request_id=?",leader,key));
            assertEquals(1,value("SELECT COUNT(*) FROM wallet_ledger WHERE user_id=? AND request_id=? AND type='FREEZE'",leader,key)); invariant();
        } finally {pool.shutdownNow();}
    }

    @Test void walletLocksFollowAscendingUserOrderAcrossAuctions() throws Exception {
        long low=user(), high=user(), a=auction(true);
        bids.placeBid(a,low,UUID.randomUUID().toString(),110,ts());
        ExecutorService pool=Executors.newSingleThreadExecutor(); Future<BidOutcome> bid=null;
        SQLException conflict=null;
        try(Connection guard=ds.getConnection(); Connection probe=ds.getConnection()) {
            guard.setAutoCommit(false); probe.setAutoCommit(false);
            guard.createStatement().executeQuery("SELECT user_id FROM wallets WHERE user_id="+low+" FOR UPDATE").close();
            bid=pool.submit(()->bids.placeBid(a,high,UUID.randomUUID().toString(),120,ts()));
            long until=ts()+5000;
            while(value("SELECT COUNT(*) FROM performance_schema.data_lock_waits") == 0 && ts()<until) Thread.sleep(20);
            assertFalse(bid.isDone(),"Bid must wait on externally held lower wallet");
            probe.createStatement().execute("SET innodb_lock_wait_timeout=1");
            try {probe.createStatement().executeQuery("SELECT user_id FROM wallets WHERE user_id="+high+" FOR UPDATE").close();}
            catch(SQLException e){conflict=e;}
            probe.rollback(); guard.rollback();
            bid.get(10,TimeUnit.SECONDS);
        } finally {pool.shutdownNow();}
        assertNull(conflict,"Higher wallet must remain unlocked while lower wallet is awaited; original reverse order causes timeout");
        invariant();
    }

    @Test void crossAuctionRequestRaceHasOneEffect() throws Exception {
        long u=user(), a=auction(true), b=auction(true); String key=UUID.randomUUID().toString();
        ExecutorService pool=Executors.newFixedThreadPool(2); CyclicBarrier gate=new CyclicBarrier(2);
        try {
            List<Future<Boolean>> calls=new ArrayList<>();
            for(long id:new long[]{a,b}) calls.add(pool.submit(()->{gate.await();try{bids.placeBid(id,u,key,110,ts());return true;}catch(BusinessException e){assertEquals(ErrorCode.IDEMPOTENT_CONFLICT,e.getErrorCode());return false;}}));
            int success=0; for(var f:calls) if(f.get(15,TimeUnit.SECONDS))success++;
            assertEquals(1,success); assertEquals(1,value("SELECT COUNT(*) FROM bids WHERE user_id=? AND request_id=?",u,key));
            assertEquals(110,value("SELECT frozen FROM wallets WHERE user_id=?",u));
            assertEquals(1,value("SELECT COUNT(*) FROM wallet_ledger WHERE user_id=? AND request_id=? AND type='FREEZE'",u,key)); invariant();
        } finally {pool.shutdownNow();}
    }

    @Test void duplicateSettlementCrashRecoveryAndNoBidResult() throws Exception {
        long u=user(), a=auction(true); bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts());
        sql.sql("UPDATE auctions SET end_time=? WHERE id=?",ts()-1,a).update();
        assertEquals(SettlementService.Claim.CLAIMED,settlements.tryClaim(a,ts()));
        // Simulates durable phase1 commit followed by loss of its caller, then a new worker.
        assertEquals(SettlementService.Claim.RESUME,settlements.tryClaim(a,ts()));
        ExecutorService pool=Executors.newFixedThreadPool(8); CyclicBarrier gate=new CyclicBarrier(8);
        try {
            List<Future<Long>> calls=new ArrayList<>();
            for(int i=0;i<8;i++)calls.add(pool.submit(()->{gate.await();return settlements.finalizeSettlement(a);}));
            for(var f:calls)f.get(15,TimeUnit.SECONDS);
        } finally {pool.shutdownNow();}
        assertEquals(1,value("SELECT COUNT(*) FROM auction_results WHERE auction_id=?",a));
        assertEquals(1,value("SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=? AND type='PAY'",a));
        assertEquals(9890,value("SELECT balance FROM wallets WHERE user_id=?",u)); invariant();
        long empty=auction(true); sql.sql("UPDATE auctions SET end_time=? WHERE id=?",ts()-1,empty).update();
        settlements.tryClaim(empty,ts());settlements.finalizeSettlement(empty);
        assertNull(auctions.detail(empty).getResult().getWinnerId());
        assertEquals(0,auctions.detail(empty).getResult().getFinalPrice());
        assertEquals(0,value("SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=?",empty));
    }

    @Test void settlementExceptionKeepsClaimAndRollsBackFundsThenResumes() throws Exception {
        long u=user(), a=auction(true); bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts());
        sql.sql("UPDATE auctions SET end_time=? WHERE id=?",ts()-1,a).update(); settlements.tryClaim(a,ts());
        long[] before=state(a,u);
        sql.sql("CREATE TRIGGER codex_fail_result BEFORE INSERT ON auction_results FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CODEX intentional settlement failure'").update();
        try {
            assertThrows(Exception.class,()->settlements.finalizeSettlement(a));
            assertArrayEquals(before,state(a,u)); assertEquals(Auction.SETTLING,auctions.detail(a).getStatus());
        } finally {sql.sql("DROP TRIGGER codex_fail_result").update();}
        settlements.finalizeSettlement(a); assertEquals(Auction.FINISHED,auctions.detail(a).getStatus()); invariant();
    }

    @Test void crossAuctionSharedWalletCannotOverfreeze() throws Exception {
        long u=user(), a=auction(true), b=auction(true);
        ExecutorService pool=Executors.newFixedThreadPool(2); CyclicBarrier gate=new CyclicBarrier(2);
        try {
            List<Future<Boolean>> calls=new ArrayList<>();
            for(long id:new long[]{a,b})calls.add(pool.submit(()->{gate.await();try{bids.placeBid(id,u,UUID.randomUUID().toString(),6000,ts());return true;}catch(BusinessException e){assertEquals(ErrorCode.INSUFFICIENT_FUNDS,e.getErrorCode());return false;}}));
            int successes=0;for(var f:calls)if(f.get(15,TimeUnit.SECONDS))successes++;
            assertEquals(1,successes);assertEquals(6000,value("SELECT frozen FROM wallets WHERE user_id=?",u));invariant();
        } finally {pool.shutdownNow();}
    }

    @Test void retryableDatabaseErrorRetriesWholeTransactionOnlyThreeTimes() throws Exception {
        long u=user(), a=auction(true);long[] before=state(a,u);String key=UUID.randomUUID().toString();
        sql.sql("CREATE TABLE codex_retry_probe(n INT NOT NULL) ENGINE=MyISAM").update();
        sql.sql("INSERT INTO codex_retry_probe VALUES(0)").update();
        sql.sql("CREATE TRIGGER codex_retry_failure BEFORE INSERT ON bids FOR EACH ROW BEGIN UPDATE codex_retry_probe SET n=n+1; SIGNAL SQLSTATE '40001' SET MYSQL_ERRNO=1213, MESSAGE_TEXT='CODEX injected retryable error'; END").update();
        try {
            BusinessException e=assertThrows(BusinessException.class,()->bids.placeBid(a,u,key,110,ts()));
            assertEquals(ErrorCode.BID_RETRYABLE,e.getErrorCode());
            assertEquals(3,value("SELECT n FROM codex_retry_probe"));assertArrayEquals(before,state(a,u));invariant();
        } finally {
            sql.sql("DROP TRIGGER codex_retry_failure").update();sql.sql("DROP TABLE codex_retry_probe").update();
        }
        assertFalse(bids.placeBid(a,u,key,110,ts()).isIdempotentReplay());invariant();
    }

    @Test void bidRacingExpiryHasOneConsistentResult() throws Exception {
        long u=user(), v=user(), a=auction(true);bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts());
        long deadline=ts()-1;sql.sql("UPDATE auctions SET end_time=?, max_extends=0 WHERE id=?",deadline,a).update();
        ExecutorService pool=Executors.newFixedThreadPool(2);CyclicBarrier gate=new CyclicBarrier(2);
        try {
            Future<?> bid=pool.submit(()->{try{gate.await();bids.placeBid(a,v,UUID.randomUUID().toString(),120,deadline-1);}catch(BusinessException e){assertEquals(ErrorCode.AUCTION_NOT_RUNNING,e.getErrorCode());}catch(Exception e){throw new RuntimeException(e);}});
            Future<?> settle=pool.submit(()->{try{gate.await();settlements.tryClaim(a,ts());settlements.finalizeSettlement(a);}catch(Exception e){throw new RuntimeException(e);}});
            bid.get(15,TimeUnit.SECONDS);settle.get(15,TimeUnit.SECONDS);
        } finally {pool.shutdownNow();}
        var result=auctions.detail(a).getResult();assertNotNull(result);
        assertEquals(1,value("SELECT COUNT(*) FROM auction_results WHERE auction_id=?",a));
        assertEquals(result.getFinalPrice(),value("SELECT MAX(amount) FROM bids WHERE auction_id=?",a));
        assertEquals(1,value("SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=? AND type='PAY'",a));invariant();
    }

    @Test void agentTokenNormalizesScopes() throws Exception {
        var service=Solon.context().getBean(com.bidarena.agent.AgentTokenService.class);
        var repo=Solon.context().getBean(com.bidarena.agent.AgentTokenRepository.class);
        var issued=service.issue(user(),auction(true)," auction:read , auction:bid ",ts()+60000,30);
        var stored=repo.findById(issued.tokenId());
        assertTrue(stored.hasScope("auction:read"));assertTrue(stored.hasScope("auction:bid"));
        assertNotEquals(issued.plainToken(),stored.getTokenHash());
    }

    @Test void disabledUserSessionIsRejectedAtCredentialBoundary() throws Exception {
        long u=user();var repo=Solon.context().getBean(com.bidarena.auth.SessionRepository.class);
        var session=repo.create(u);assertEquals(u,repo.findValidUserId(session.token()));
        sql.sql("UPDATE users SET status='DISABLED' WHERE id=?",u).update();
        assertNull(repo.findValidUserId(session.token()));
    }

    @Test void postCommitBroadcastFailureCannotUndoRealDatabaseBid() throws Exception {
        long u=user(), a=auction(true);
        BidOutcome committed=bids.placeBid(a,u,UUID.randomUUID().toString(),110,ts());
        long[] before=state(a,u);
        var writer=Solon.context().getBean(AuctionEventWriter.class);
        var field=AuctionEventWriter.class.getDeclaredField("broadcaster");field.setAccessible(true);
        Object original=field.get(writer);
        try {
            field.set(writer,new com.bidarena.websocket.WsBroadcaster() {
                @Override public void broadcast(long auctionId,String payload) {throw new IllegalStateException("CODEX injected network broadcast failure");}
            });
            assertDoesNotThrow(()->writer.broadcastSince(a,committed.getFirstEventSeq()));
        } finally {field.set(writer,original);}
        assertArrayEquals(before,state(a,u));
        assertEquals(1,value("SELECT COUNT(*) FROM bids WHERE auction_id=?",a));invariant();
    }
}
