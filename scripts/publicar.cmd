@echo off
setlocal
pushd "%~dp0.."
if errorlevel 1 exit /b 1

for /f "delims=" %%B in ('git branch --show-current') do set "publishBranch=%%B"
if not "%publishBranch%"=="main" (
  echo Execute a publicacao na branch main.
  goto failure
)

git diff --cached --quiet
if errorlevel 1 (
  echo Existem arquivos preparados para outro commit. Conclua esse commit antes.
  goto failure
)

echo Validando TypeScript...
call npm.cmd run typecheck
if errorlevel 1 goto failure
echo Compilando aplicacao...
call npm.cmd run build
if errorlevel 1 goto failure

echo Conferindo repositorio remoto...
git fetch origin main
if errorlevel 1 goto failure
git merge-base --is-ancestor origin/main HEAD
if errorlevel 1 (
  echo A main remota tem alteracoes que precisam ser integradas antes de publicar.
  goto failure
)

echo Preparando arquivos do projeto...
git add -- src netlify supabase .github scripts README.md package.json package-lock.json netlify.toml vite.config.ts tsconfig.json tailwind.config.cjs postcss.config.cjs index.html vercel.json .gitignore
if errorlevel 1 goto failure
git diff --cached --quiet
if not errorlevel 1 goto send
git commit -m "Atualiza aplicacao e pipeline"
if errorlevel 1 goto failure

:send
git push origin main
if errorlevel 1 goto failure
echo Codigo enviado ao GitHub. Acompanhe a validacao na aba Actions.
popd
exit /b 0

:failure
echo Publicacao interrompida. Confira a mensagem acima.
popd
exit /b 1
