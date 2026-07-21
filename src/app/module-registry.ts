import { featureRegistry } from "@/app/feature-registry";
import { loggingFeature } from "@/features/logging";
import { systemFeature } from "@/features/system";

// This is the only frontend file that must change when a source module is added or removed.
featureRegistry
  .register(systemFeature)
  .register(loggingFeature);

export { featureRegistry };
