/**
 * Flag keys the starter's shared features use. New tenants get each one switched on, and the
 * seed adds any that a tenant is missing. Apps may add their own keys; unknown keys are off.
 */
export const STARTER_FEATURE_KEYS = ["catalog", "profile"] as const;
export type StarterFeatureKey = (typeof STARTER_FEATURE_KEYS)[number];
