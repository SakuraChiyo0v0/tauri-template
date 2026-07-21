import { FeatureRegistry } from "@/core/features/feature-registry";
import { loggingFeature } from "@/features/logging";

// This is the only frontend file that must change when a source module is added or removed.
export const featureRegistry = new FeatureRegistry().register(loggingFeature);
