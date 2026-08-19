import type { Database } from 'bun:sqlite'
import { migrateLegacySchemaIfNeeded } from './legacy'
import {
    migrateFromV1ToV2,
    migrateFromV2ToV3,
    migrateFromV3ToV4,
    migrateFromV4ToV5,
    migrateFromV5ToV6,
    migrateFromV6ToV7,
    migrateFromV7ToV8,
    migrateFromV8ToV9,
    migrateFromV9ToV10,
    migrateFromV10ToV11
} from './v1ToV11'
import {
    migrateFromV11ToV12,
    migrateFromV12ToV13,
    migrateFromV13ToV14,
    migrateFromV14ToV15,
    migrateFromV15ToV16,
    migrateFromV16ToV17,
    migrateFromV17ToV18,
    migrateFromV18ToV19,
    migrateFromV19ToV20
} from './v11ToV20'

export { migrateLegacySchemaIfNeeded }

export function buildStepMigrations(db: Database, legacy: boolean): Record<number, () => void> {
    return {
        1: () => migrateFromV1ToV2(db, legacy),
        2: () => migrateFromV2ToV3(),
        3: () => migrateFromV3ToV4(db),
        4: () => migrateFromV4ToV5(db),
        5: () => migrateFromV5ToV6(db),
        6: () => migrateFromV6ToV7(db),
        7: () => migrateFromV7ToV8(db),
        8: () => migrateFromV8ToV9(db),
        9: () => migrateFromV9ToV10(db),
        10: () => migrateFromV10ToV11(db),
        11: () => migrateFromV11ToV12(db),
        12: () => migrateFromV12ToV13(db),
        13: () => migrateFromV13ToV14(db),
        14: () => migrateFromV14ToV15(db),
        15: () => migrateFromV15ToV16(db),
        16: () => migrateFromV16ToV17(db),
        17: () => migrateFromV17ToV18(db),
        18: () => migrateFromV18ToV19(db),
        19: () => migrateFromV19ToV20(db),
    }
}
