import { contaHasActiveModule } from "../services/contas/storeModulesService";
import { createAppModuleAccess } from "./appModuleAccessPolicy";
import { hasPermission } from "../helpers/userPermission";
import { getCustomRequest } from "../helpers/getCustomRequest";

const names = { whatsapp: "WhatsApp", arena: "Arena", "loja-virtual": "Loja Virtual" };
export function requireStoreApp(code: keyof typeof names) {
  return createAppModuleAccess(code, names[code], contaHasActiveModule, req => hasPermission(getCustomRequest(req).customData, code === "whatsapp" ? 5 : 2));
}
