-- Auction lock serializes this auction's holds; wallet locks serialize cross-auction funds.
CREATE INDEX idx_holds_auction_user ON wallet_holds(auction_id, user_id);
