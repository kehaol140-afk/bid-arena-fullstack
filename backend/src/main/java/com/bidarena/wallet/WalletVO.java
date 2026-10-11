package com.bidarena.wallet;

public class WalletVO {
    private long userId;
    private long balance;
    private long frozen;
    private long available;

    public WalletVO() {
    }

    public WalletVO(long userId, long balance, long frozen) {
        this.userId = userId;
        this.balance = balance;
        this.frozen = frozen;
        this.available = balance - frozen;
    }

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

    public long getAvailable() {
        return available;
    }

    public void setAvailable(long available) {
        this.available = available;
    }
}
