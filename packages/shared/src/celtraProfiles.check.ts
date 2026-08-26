/**
 * Quick integrity check for the golden Celtra profile.
 * Run: pnpm exec tsx packages/shared/src/celtraProfiles.check.ts
 */
import { assertGuaranteeTranche3ProfileIntegrity } from "./celtraProfiles.js";

assertGuaranteeTranche3ProfileIntegrity();
console.log("guarantee_tranche3_social_video_v1 OK");
