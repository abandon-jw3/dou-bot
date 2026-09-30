import { test, expect, type Page } from '@playwright/test';

async function waitForClient(page: Page): Promise<void> {
  // VitePress 在异步加载首个页面后才挂载 Vue；load 事件并不保证按钮已绑定事件。
  // 等待锁定版本 Vue 的挂载标记，避免公网首次加载时点击到静态 HTML。
  await page.waitForFunction(() => {
    const app = document.querySelector('#app');
    return app !== null && '__vue_app__' in app;
  });
}

test('首页、快速开始、主题切换与手机导航', async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('./');
  await waitForClient(page);
  await expect(page).toHaveTitle(/dou-bot/);
  await expect(page.locator('h1')).toContainText('用装饰器编写 QQ 机器人');
  await page.locator('.VPHero').getByRole('link', { name: '快速开始', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('快速开始');
  if (isMobile) {
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.locator('.VPSidebar').getByRole('link', { name: '命令与帮助', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('命令与帮助');
    await page.locator('.VPNavBarHamburger').click();
  }
  const appearance = page.getByRole('switch').filter({ visible: true }).first();
  const initial = (await page.locator('html').getAttribute('class')) ?? '';
  await appearance.click();
  await expect
    .poll(async () => (await page.locator('html').getAttribute('class')) ?? '')
    .not.toBe(initial);
  await page.reload();
  await waitForClient(page);
  await expect
    .poll(async () => (await page.locator('html').getAttribute('class')) ?? '')
    .not.toBe(initial);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

for (const query of ['二次输入', '管理员', 'UseGuards', 'Slot']) {
  test(`本地搜索：${query}`, async ({ page }) => {
    await page.goto('./');
    await waitForClient(page);
    await page.getByRole('button', { name: '搜索文档' }).click();
    const input = page.locator('.VPLocalSearchBox input');
    await input.fill(query);
    const result = page.locator('.VPLocalSearchBox .result').first();
    await expect(result).toBeVisible();
    await expect(result).toContainText(new RegExp(query === '管理员' ? '管理' : query));
    await result.click();
    await expect(page).toHaveURL(/\/dou-bot\/(?:guide|api|examples)\//);
    await expect(page.locator('h1')).toBeVisible();
  });
}

test('深层页面直接刷新、页内目录与代码复制', async ({ page, context, isMobile }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const response = await page.goto('guide/quick-start.html');
  expect(response?.status()).toBe(200);
  await page.reload();
  await waitForClient(page);
  await expect(page.locator('h1')).toHaveText('快速开始');
  await expect(page.getByRole('link', { name: '在 GitHub 上编辑此页' })).toHaveAttribute(
    'href',
    'https://github.com/abandon-jw3/dou-bot/edit/main/website/docs/guide/quick-start.md',
  );
  const code = page.locator('div[class*="language-sh"]').first();
  if (!isMobile) await code.hover();
  await code.locator('button.copy').click({ force: true });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('npm install --save-exact dou-bot@0.6.0');
  await page.goto('guide/guards.html#模块统一配置');
  await waitForClient(page);
  await expect(page.locator('#模块统一配置')).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
});
