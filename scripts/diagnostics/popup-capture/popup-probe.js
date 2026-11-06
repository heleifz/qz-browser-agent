const portal = await qz.openTab({ url: args.url || 'http://127.0.0.1:8870/portal', tabAlias: 'portal' });
const page = qz.tab(portal.tabRef);
const popup = await page.locator({ role: 'link', name: 'Alpine Kettle' }).click({ waitFor: 'popup', timeout: 15 });
trace('popup returned ' + JSON.stringify(popup));
const before = await qz.listTabs();
let observation;
try {
  observation = await qz.tab(popup.tabRef).evaluate(() => ({
    title: document.title,
    url: location.href,
    ready: document.readyState,
    text: document.body?.innerText
  }));
} catch (error) {
  observation = { code: error.code, message: error.message, details: error.details };
}
const after = await qz.listTabs();
return { popup, before, observation, after };
