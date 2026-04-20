import { Router } from 'express'
import { authenticateJWT } from '../../middlewares/auth'
import {
  gerarCicloAssinatura,
  getAssinaturaDetalhe,
  getAssinaturas,
  getAssinaturasDashboard,
  getAssinaturasOpcoes,
  getCobrancasAssinatura,
  getComodatosAssinatura,
  getPlanosAssinatura,
  saveAssinatura,
  savePlanoAssinatura,
  updateAssinaturaStatus,
  updateCicloAssinaturaStatus,
  updateComodatoAssinaturaStatus,
} from '../../controllers/assinaturas'

const routerAssinaturas = Router()

routerAssinaturas.get('/dashboard', authenticateJWT, getAssinaturasDashboard)
routerAssinaturas.get('/opcoes', authenticateJWT, getAssinaturasOpcoes)

routerAssinaturas.get('/planos', authenticateJWT, getPlanosAssinatura)
routerAssinaturas.post('/planos', authenticateJWT, savePlanoAssinatura)

routerAssinaturas.get('/assinaturas', authenticateJWT, getAssinaturas)
routerAssinaturas.post('/assinaturas', authenticateJWT, saveAssinatura)
routerAssinaturas.get('/assinaturas/:id', authenticateJWT, getAssinaturaDetalhe)
routerAssinaturas.post('/assinaturas/:id/status', authenticateJWT, updateAssinaturaStatus)
routerAssinaturas.post('/assinaturas/:id/gerar-ciclo', authenticateJWT, gerarCicloAssinatura)

routerAssinaturas.get('/cobrancas', authenticateJWT, getCobrancasAssinatura)
routerAssinaturas.post('/cobrancas/:id/status', authenticateJWT, updateCicloAssinaturaStatus)

routerAssinaturas.get('/comodatos', authenticateJWT, getComodatosAssinatura)
routerAssinaturas.post('/comodatos/:id/status', authenticateJWT, updateComodatoAssinaturaStatus)

export { routerAssinaturas }
