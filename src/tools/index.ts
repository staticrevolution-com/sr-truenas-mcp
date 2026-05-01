import { TrueNASClient } from "../client.js";
import { ToolRegistry } from "../registry.js";

import { register as registerSystem } from "./system.js";
import { register as registerStorage } from "./storage.js";
import { register as registerSharing } from "./sharing.js";
import { register as registerNetwork } from "./network.js";
import { register as registerVm } from "./vm.js";
import { register as registerAlert } from "./alert.js";
import { register as registerReplication } from "./replication.js";
import { register as registerFilesystem } from "./filesystem.js";

export function buildRegistry(client: TrueNASClient): ToolRegistry {
  const registry = new ToolRegistry();

  // All register() functions call registry.tool() which captures definitions
  registerSystem(registry as any, client);
  registerStorage(registry as any, client);
  registerSharing(registry as any, client);
  registerNetwork(registry as any, client);
  registerVm(registry as any, client);
  registerAlert(registry as any, client);
  registerReplication(registry as any, client);
  registerFilesystem(registry as any, client);

  return registry;
}
