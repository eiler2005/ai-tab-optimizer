import { test, expect } from './fixtures';

test('tabs are first; filtered selection exposes hidden choices and menus remain reachable', async ({ panel, worker }, testInfo) => {
  await worker.evaluate(async () => {
    await chrome.tabs.create({ url: 'http://aitab.test/filter-one', active: false });
    await chrome.tabs.create({ url: 'http://aitab.test/filter-two', active: false });
    await chrome.tabs.create({ url: 'http://aitab.test/other', active: false });
  });
  const navigation = panel.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('button').first()).toHaveText('Tabs');
  await expect(navigation.getByRole('button', { name: 'Tabs', exact: true })).toHaveAttribute('aria-current', 'page');
  await panel.getByLabel('Find materials', { exact: true }).fill('filter-');
  await expect(panel.locator('[data-tab-id]')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Select results', exact: true }).click();
  await expect(panel.getByText('Selected: 2 · Outside filter: 0', { exact: true })).toBeVisible();
  await panel.getByLabel('Find materials', { exact: true }).fill('filter-one');
  await expect(panel.getByText('Selected: 2 · Outside filter: 1', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Topics', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Topics', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Collections', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'More', exact: false }).click();
  await panel.getByRole('button', { name: 'Journal and Undo', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Journal and Undo', exact: true })).toBeVisible();
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('navigation.png') });
});
