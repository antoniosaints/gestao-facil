-- Layout padrão da dashboard por conta e layout pessoal opcional do administrador.
ALTER TABLE `Contas` ADD COLUMN `dashboardLayoutPadrao` JSON NULL;
ALTER TABLE `Usuarios` ADD COLUMN `dashboardLayout` JSON NULL;
