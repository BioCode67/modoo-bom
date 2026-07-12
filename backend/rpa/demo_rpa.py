"""체험 모드 RPA — 개인정보 없이 '실제 정부24를 자동 조작하는 것'을 스크린샷으로 보여주고
본인인증 벽에서 정지한다. 배포 사이트 방문자(심사위원·참가자)가 설정·인증·개인정보 없이도
'진짜로 정부 사이트가 움직인다'를 눈으로 체험하게 하는 표(추천) 유도용.

정직성 원칙(중요):
- 이건 mock 화면이 아니라 **진짜 정부24 페이지에 실제로 접속·이동한 실시간 스크린샷**이다.
- 주민번호·이름 등 개인정보를 **요구도 전송도 하지 않는다**(본인인증 직전에서 정지).
- 실제 발급(끝까지)은 본인인증이 필요하므로 별도 '옵트인' 경로로만(자기 정보·자기 폰).
"""
from __future__ import annotations

import asyncio

from playwright.async_api import async_playwright

from rpa.base import launch_browser, make_browser_context_args, take_screenshot
from rpa.gov24_rpa import DOC_URLS

# 정부24 간편인증 로그인 진입(여기 화면이 '본인 폰 인증' 시작점 — 체험은 여기서 정지)
GOV24_LOGIN = "https://www.gov.kr/nlogin/?Mcode=10003"
GOV24_HOME = "https://www.gov.kr/portal/main/nologin"


async def run_demo_rpa(task, doc_name: str):
    """실제 정부24를 자동 조작하는 과정을 스크린샷으로 보여주고 인증벽에서 정지(개인정보 0)."""
    info_url = DOC_URLS.get(doc_name, GOV24_HOME)
    async with async_playwright() as pw:
        browser = await launch_browser(pw)
        try:
            ctx = await browser.new_context(**make_browser_context_args())
            page = await ctx.new_page()

            task.update("running", f"실제 정부24에 접속하고 있어요… (서류: {doc_name})")
            # ① 실제 민원 안내 페이지로 자동 이동
            try:
                await page.goto(info_url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(1.3)
                ss = await take_screenshot(page)
                task.update("running", f"실제 정부24 ‘{doc_name}’ 민원 페이지에 도달했어요 (프로그램이 자동으로 이동)", ss)
            except Exception:
                # 안내 페이지가 막히면 홈이라도(둘 다 실측 200) — 그래도 '진짜 접속'은 보여줌
                await page.goto(GOV24_HOME, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(1.0)
                ss = await take_screenshot(page)
                task.update("running", "실제 정부24에 접속했어요 (프로그램이 자동으로 이동)", ss)

            await asyncio.sleep(0.8)

            # ② 본인인증(간편인증) 화면으로 이동 — 여기서부터는 '본인 폰'
            try:
                await page.goto(GOV24_LOGIN, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(1.6)
                ss2 = await take_screenshot(page)
                task.update(
                    "running",
                    "여기가 본인인증(간편인증) 화면이에요 — 실제 발급은 여기서부터 ‘본인 폰에서 카카오·PASS 승인’으로 이어져요",
                    ss2,
                )
            except Exception:
                pass

            await asyncio.sleep(0.6)
            task.update(
                "done",
                "체험 완료 — 방금 프로그램이 ‘진짜’ 정부24를 자동으로 조작했어요. "
                "실제 서류 발급은 본인인증(내 폰)만 하면 이어서 자동으로 끝나요.",
            )
        finally:
            try:
                await browser.close()
            except Exception:
                pass
