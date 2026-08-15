@echo off
setlocal enabledelayedexpansion
title Send 50mm Retina code to GitHub
color 0B

echo.
echo  ================================================================
echo    SENDING YOUR CODE TO GITHUB
echo    57 commits of work, packaged by Claude.
echo    You do not need to type anything. Just watch.
echo  ================================================================
echo.

set "HERE=%~dp0"
set "BUNDLE=%HERE%50mm-57-commits.bundle"
set "WORK=%HERE%50mm-push-workspace"
set "REPO=https://github.com/altisinfonet/lens-lustre-learn-Claude.git"

REM ---------- Step 1: is git installed? ----------
echo  [1/5] Checking that Git is installed...
where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo  *** GIT IS NOT INSTALLED ON THIS COMPUTER ***
  echo.
  echo  Git is the free tool that sends code to GitHub. Install it once,
  echo  then run this file again.
  echo.
  echo    1. Open this page:  https://git-scm.com/download/win
  echo    2. Run the installer, click Next on every screen.
  echo    3. Double-click this file again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('git --version') do echo        Found: %%v

REM ---------- Step 2: is the bundle here? ----------
echo  [2/5] Checking the code package is beside this file...
if not exist "%BUNDLE%" (
  echo.
  echo  *** MISSING: 50mm-57-commits.bundle ***
  echo.
  echo  This file must sit in the SAME folder as the package.
  echo  Both were delivered together - keep them together.
  echo.
  pause
  exit /b 1
)
echo        Found the package.

REM ---------- Step 3: get a fresh copy of the repository ----------
echo  [3/5] Downloading the current code from GitHub...
echo        (A browser window may open asking you to sign in to GitHub.
echo         That is normal and it only happens once on this computer.)
if exist "%WORK%" rmdir /s /q "%WORK%"
git clone --quiet "%REPO%" "%WORK%"
if errorlevel 1 (
  echo.
  echo  *** COULD NOT REACH GITHUB ***
  echo.
  echo  Most likely one of these:
  echo    - No internet connection right now.
  echo    - The sign-in was cancelled or the wrong account was used.
  echo      The account that owns this code is: altisinfonet
  echo.
  echo  Nothing was changed. It is safe to run this file again.
  echo.
  pause
  exit /b 1
)
echo        Downloaded.

cd /d "%WORK%"

REM ---------- Step 4: bring in the 57 commits ----------
echo  [4/5] Adding the 57 new commits...
git fetch --quiet "%BUNDLE%" main:claude-work
if errorlevel 1 (
  echo.
  echo  *** THE PACKAGE COULD NOT BE READ ***
  echo  The file may have been damaged in transfer. Ask Claude to send it again.
  echo.
  pause
  exit /b 1
)

git merge --ff-only claude-work
if errorlevel 1 (
  echo.
  echo  *** STOPPED ON PURPOSE - NOTHING WAS CHANGED ***
  echo.
  echo  GitHub has moved on since this package was made, so these commits
  echo  cannot simply be added on top. Nothing has been lost and nothing
  echo  has been overwritten - that is exactly why it stopped here.
  echo.
  echo  Tell Claude: "ff-only merge refused, GitHub has newer commits."
  echo  Claude will rebuild the package against the newer history.
  echo.
  pause
  exit /b 1
)
echo        Added.

REM ---------- Step 5: send them to GitHub ----------
echo  [5/5] Sending to GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo  *** THE SEND WAS REFUSED ***
  echo.
  echo  The code was prepared correctly but GitHub would not accept it.
  echo  Usually this means the signed-in account cannot write to this
  echo  repository. The account that owns it is: altisinfonet
  echo.
  echo  Nothing was lost. Tell Claude what this window says.
  echo.
  pause
  exit /b 1
)

echo.
echo  ================================================================
echo    DONE. All 57 commits are now on GitHub.
echo  ================================================================
echo.
echo  You can check them here:
echo    https://github.com/altisinfonet/lens-lustre-learn-Claude/commits/main
echo.
echo  The working folder "50mm-push-workspace" next to this file can be
echo  deleted whenever you like - it is only a scratch copy.
echo.
pause
exit /b 0
