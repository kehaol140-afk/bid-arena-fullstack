import { describe, expect, it } from 'vitest'
import { isDemoAuction } from '../demoAuctions'

describe('explicit demo selection', () => {
  it('keeps seeded/marked demo lots while not classifying a test title as demo', () => {
    expect(isDemoAuction({title:'演示拍品·经典机械腕表（DRAFT）',description:null})).toBe(true)
    expect(isDemoAuction({title:'用户拍品',description:'[DEMO] 录屏使用'})).toBe(true)
    expect(isDemoAuction({title:'E2E????',description:null})).toBe(false)
    expect(isDemoAuction({title:'普通用户拍品',description:null})).toBe(false)
  })
})
