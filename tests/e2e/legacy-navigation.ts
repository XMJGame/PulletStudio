import type { Page } from '@playwright/test';

export async function selectLegacyView(page: Page, view = '分集与镜头') {
  const tools = page.locator('.legacy-tools');
  if (!(await tools.evaluate((element) => (element as HTMLDetailsElement).open)))
    await tools.locator('summary').click();
  await page.getByRole('button', { name: view, exact: true }).click();
}
