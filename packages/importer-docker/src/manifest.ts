import { dockerConfigSchema } from "./config.js";
import { dockerTargetProfileSchema } from "./target-profile.js";

// All keys are transport-dependent: which are required is decided by the
// resolved target profile's transport, so coverage validation cannot
// declare any statically required (ADR-121).
export const manifest = {
  name: "docker",
  label: "Docker",
  description:
    "Import Docker Engine workloads from the Hub or an Import Agent.",
  version: "1.0.0",
  implPath: "@componode/importer-docker/importer",
  reportsSourceIdentity: true,
  targetRefKey: "targetId",
  configSchema: dockerConfigSchema,
  targetProfileSchema: dockerTargetProfileSchema,
  secrets: [
    { key: "caCert", label: "CA certificate (private CA, PEM)", required: false },
    { key: "clientCert", label: "Client certificate (mTLS, PEM)", required: false },
    { key: "clientKey", label: "Client key (mTLS, PEM)", required: false },
    { key: "sshPrivateKey", label: "SSH private key (PEM)", required: false },
    { key: "sshPassphrase", label: "SSH key passphrase", required: false },
  ],
};
