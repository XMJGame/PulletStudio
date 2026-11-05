import { expect, Page } from '@playwright/test';

export async function exerciseTakeReview(page: Page) {
  const dialog = page.getByRole('dialog', { name: '镜头素材与候选' });
  await dialog.getByRole('button', { name: /查看候选 Take 02 · clip.mp4/ }).click();
  const review = dialog.getByRole('region', { name: '候选审核', exact: true });
  await expect(review).toContainText('Take 02 · 草稿');
  const video = dialog.locator('video');
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.1);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await review.getByLabel('审核或选片理由').fill('Review the returned video and its fixed inputs.');
  const pattern = '**/api/v1/takes/*/reviews';
  let lost = false;
  let originalKey = '';
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const key = route.request().headers()['idempotency-key'];
    if (!lost) {
      originalKey = key;
      lost = true;
      expect((await route.fetch()).status()).toBe(201);
      await route.abort('failed');
    } else {
      expect(key).toBe(originalKey);
      await route.continue();
    }
  });
  await review.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(review.getByRole('alert')).toBeVisible();
  await expect(review.getByLabel('审核或选片理由')).toHaveValue(
    'Review the returned video and its fixed inputs.',
  );
  await review.getByRole('button', { name: '提交审核', exact: true }).click();
  await expect(review).toContainText('Take 02 · 待审核');
  await page.unroute(pattern);
  await review.getByLabel('审核或选片理由').fill('Motion and framing are accepted.');
  await review.getByRole('button', { name: '批准候选', exact: true }).click();
  await expect(review).toContainText('Take 02 · 已批准');
  await review.getByLabel('审核或选片理由').fill('Use this approved version in the film.');
  await review.getByRole('button', { name: '选用此候选', exact: true }).click();
  await expect(review).toContainText('镜头选片 · Take 02（有效）');
  await review.getByText('审核历史', { exact: true }).click();
  await expect(
    review.getByText('Review the returned video and its fixed inputs.', { exact: true }),
  ).toHaveCount(1);
  await expect(review).toContainText('生成来源制作卡');
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/take-review-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await review.getByRole('button', { name: '撤销批准', exact: true }).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/take-review-mobile.png' });
  await review.getByLabel('审核或选片理由').fill('Rework the final motion.');
  await review.getByRole('button', { name: '撤销批准', exact: true }).click();
  await expect(review).toContainText('Take 02 · 已撤销');
  await expect(review).toContainText('已失效，需要重新审核或选用');
  await review.getByLabel('审核或选片理由').fill('Remove the revoked selection.');
  await review.getByRole('button', { name: '清除镜头选片', exact: true }).click();
  await expect(review).toContainText('镜头选片 · 尚未选用');
  await review.getByText('选片历史', { exact: true }).click();
  await expect(review.getByText('Use this approved version in the film.', { exact: true })).toBeVisible();
  await expect(review.getByText('Remove the revoked selection.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
