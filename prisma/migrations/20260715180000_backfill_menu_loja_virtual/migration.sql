-- A Loja Virtual não tinha key de menu: aparecia sempre que o app estivesse ativo, sem passar
-- pela whitelist de `menusVisiveis`. Agora ela é configurável como os demais menus.
--
-- Sem este backfill, toda conta que já salvou uma configuração de visibilidade (array sem a
-- key nova) perderia o menu da Loja Virtual — a whitelist a trataria como oculta. Aqui
-- adicionamos a key às contas existentes para preservar o comportamento atual: quem enxergava
-- a loja continua enxergando, e agora pode escolher ocultá-la.
--
-- Contas com `menusVisiveis` NULL não são tocadas: NULL significa "sem configuração" e já
-- resulta em tudo visível.
--
-- O gate do app continua valendo: contas sem o módulo loja-virtual contratado não veem o menu,
-- independentemente desta key.

UPDATE `ParametrosConta`
SET `menusVisiveis` = JSON_ARRAY_APPEND(`menusVisiveis`, '$', 'loja-virtual')
WHERE `menusVisiveis` IS NOT NULL
  AND JSON_VALID(`menusVisiveis`)
  AND JSON_TYPE(`menusVisiveis`) = 'ARRAY'
  AND JSON_SEARCH(`menusVisiveis`, 'one', 'loja-virtual') IS NULL;
