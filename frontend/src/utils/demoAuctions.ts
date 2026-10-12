import type { Auction } from '@/types'

/** Explicit seed identity or administrator marker; no data deletion or guesses about test titles. */
export function isDemoAuction(auction: Pick<Auction, 'title' | 'description'>): boolean {
  return auction.title === '演示拍品·经典机械腕表（DRAFT）' || !!auction.description?.startsWith('[DEMO]')
}
