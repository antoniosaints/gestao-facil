import { Router } from 'express'
import { authenticateJWT } from '../../middlewares/auth'
import {
  gerarCicloAssinatura,
  getAssinaturaDetalhe,
  getAssinaturas,
  getAssinaturasDashboard,
  getAssinaturasMobile,
  getAssinaturasOpcoes,
  getAssinaturasTable,
  getCobrancasAssinatura,
  getCobrancasAssinaturaMobile,
  getCobrancasAssinaturaTable,
  getComodatosAssinatura,
  getComodatosAssinaturaMobile,
  getComodatosAssinaturaTable,
  getPlanosAssinatura,
  getPlanosAssinaturaMobile,
  getPlanosAssinaturaTable,
  saveAssinatura,
  savePlanoAssinatura,
  select2PlanosAssinatura,
  updateAssinaturaStatus,
  updateCicloAssinaturaStatus,
  updateComodatoAssinaturaStatus,
} from '../../controllers/assinaturas'

const routerAssinaturas = Router()

routerAssinaturas.get('/dashboard', authenticateJWT, getAssinaturasDashboard)
routerAssinaturas.get('/opcoes', authenticateJWT, getAssinaturasOpcoes)

routerAssinaturas.get('/planos', authenticateJWT, getPlanosAssinatura)
routerAssinaturas.get('/planos/select2', authenticateJWT, select2PlanosAssinatura)
routerAssinaturas.get('/planos/tabela', authenticateJWT, getPlanosAssinaturaTable)
routerAssinaturas.get('/planos/mobile', authenticateJWT, getPlanosAssinaturaMobile)
routerAssinaturas.post('/planos', authenticateJWT, savePlanoAssinatura)

routerAssinaturas.get('/assinaturas', authenticateJWT, getAssinaturas)
routerAssinaturas.get('/assinaturas/tabela', authenticateJWT, getAssinaturasTable)
routerAssinaturas.get('/assinaturas/mobile', authenticateJWT, getAssinaturasMobile)
routerAssinaturas.post('/assinaturas', authenticateJWT, saveAssinatura)
routerAssinaturas.get('/assinaturas/:id', authenticateJWT, getAssinaturaDetalhe)
routerAssinaturas.post('/assinaturas/:id/status', authenticateJWT, updateAssinaturaStatus)
routerAssinaturas.post('/assinaturas/:id/gerar-ciclo', authenticateJWT, gerarCicloAssinatura)

routerAssinaturas.get('/cobrancas', authenticateJWT, getCobrancasAssinatura)
routerAssinaturas.get('/cobrancas/tabela', authenticateJWT, getCobrancasAssinaturaTable)
routerAssinaturas.get('/cobrancas/mobile', authenticateJWT, getCobrancasAssinaturaMobile)
routerAssinaturas.post('/cobrancas/:id/status', authenticateJWT, updateCicloAssinaturaStatus)

routerAssinaturas.get('/comodatos', authenticateJWT, getComodatosAssinatura)
routerAssinaturas.get('/comodatos/tabela', authenticateJWT, getComodatosAssinaturaTable)
routerAssinaturas.get('/comodatos/mobile', authenticateJWT, getComodatosAssinaturaMobile)
routerAssinaturas.post('/comodatos/:id/status', authenticateJWT, updateComodatoAssinaturaStatus)

export { routerAssinaturas }
