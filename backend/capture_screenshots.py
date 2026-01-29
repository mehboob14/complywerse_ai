#!/usr/bin/env python3
import asyncio
from playwright.async_api import async_playwright

async def capture_screenshots():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = await context.new_page()
        
        base_url = "http://localhost:3000"
        output_dir = "../website/public/screenshots"
        
        print("Logging in...")
        await page.goto(f"{base_url}/login")
        await page.wait_for_load_state('networkidle')
        
        await page.fill('input[type="email"]', 'admin@example.com')
        await page.fill('input[type="password"]', 'password123')
        await page.click('button[type="submit"]')
        
        await page.wait_for_timeout(3000)
        
        screenshots = [
            ("/dashboard", "dashboard.png", "Dashboard"),
            ("/control-library", "control-library.png", "Control Library"),
            ("/frameworks", "frameworks.png", "Frameworks"),
            ("/risk-management", "risk-management.png", "Risk Management"),
            ("/evidence", "evidence.png", "Evidence Management"),
            ("/certifications", "certifications.png", "Certifications"),
        ]
        
        for path, filename, name in screenshots:
            print(f"Capturing {name}...")
            try:
                await page.goto(f"{base_url}{path}")
                await page.wait_for_load_state('networkidle')
                await page.wait_for_timeout(2000)
                await page.screenshot(path=f"{output_dir}/{filename}", full_page=False)
                print(f"  Saved {filename}")
            except Exception as e:
                print(f"  Error capturing {name}: {e}")
        
        await browser.close()
        print("Done!")

if __name__ == "__main__":
    asyncio.run(capture_screenshots())
