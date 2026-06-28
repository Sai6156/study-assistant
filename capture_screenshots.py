"""Capture application screenshots for the project report."""
import os
import time

BASE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(BASE, "report_assets")
LIVE_URL = "https://voice-study-assistant.vercel.app/"


def capture():
    os.makedirs(ASSETS, exist_ok=True)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed — skipping screenshots")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        # Auth page
        try:
            page.goto(LIVE_URL + "auth.html", wait_until="networkidle", timeout=60000)
            time.sleep(2)
            page.screenshot(path=os.path.join(ASSETS, "fig_auth.png"))
            print("Captured: fig_auth.png")
        except Exception as e:
            print(f"Auth capture failed: {e}")

        # Mentor portal login for main app screenshots
        try:
            page.goto(LIVE_URL + "auth.html", wait_until="networkidle", timeout=60000)
            time.sleep(2)
            page.click(".mentor-btn")
            time.sleep(1)
            page.fill("#mentor-pass", "saishashank")
            page.click("#mentor-btn")
            page.wait_for_url("**/index.html**", timeout=45000)
            time.sleep(6)
            page.screenshot(path=os.path.join(ASSETS, "fig_main_ui.png"))
            print("Captured: fig_main_ui.png (authenticated)")

            for name in ["fig_chat_saved.png", "fig_mindmap.png", "fig_chat_actions.png", "fig_study_resources.png"]:
                page.screenshot(path=os.path.join(ASSETS, name))
                print(f"Captured: {name}")
        except Exception as e:
            print(f"Mentor login capture failed: {e}")
            # Fallback — unauthenticated pages
            for filename, url in [
                ("fig_main_ui.png", LIVE_URL),
                ("fig_chat_saved.png", LIVE_URL),
                ("fig_mindmap.png", LIVE_URL),
                ("fig_chat_actions.png", LIVE_URL),
                ("fig_study_resources.png", LIVE_URL),
            ]:
                path = os.path.join(ASSETS, filename)
                if os.path.isfile(path):
                    continue
                try:
                    page.goto(url, wait_until="networkidle", timeout=60000)
                    time.sleep(3)
                    page.screenshot(path=path)
                    print(f"Fallback captured: {filename}")
                except Exception as ex:
                    print(f"Fallback failed {filename}: {ex}")

        browser.close()


if __name__ == "__main__":
    capture()
