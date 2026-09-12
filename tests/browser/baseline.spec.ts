import {test,expect} from '@playwright/test';
test('existing UI creates a plan through its HTTP contract and survives reload',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Plans',exact:true}).first().click();
 await page.getByRole('button',{name:/Create plan|New plan/i}).first().click();
 const dialog=page.getByRole('dialog',{name:'Create workout plan'});
 await expect(dialog).toBeVisible();
 await dialog.getByLabel('Plan name').fill('Browser Contract Plan');
 await dialog.getByRole('button').filter({hasText:'Synthetic Press'}).click();
 const request=page.waitForRequest(r=>r.url().includes('/api/data')&&r.method()==='POST'&&r.postDataJSON().action==='createPlan');
 await dialog.getByRole('button',{name:/Save plan/}).click();
 const payload=(await request).postDataJSON();
 expect(payload.name).toBe('Browser Contract Plan');expect(payload.days[0].exercises[0].exerciseId).toBe(1);
 await expect(dialog).not.toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Plans',exact:true}).first().click();
 await expect(page.getByText('Browser Contract Plan',{exact:true})).toBeVisible();
});
test('load failure is visible and retry reloads data',async({page})=>{
 let fail=true;await page.route('**/api/data?*',route=>fail?route.fulfill({status:503,json:{error:'Synthetic service unavailable'}}):route.continue());
 await page.goto('/');await expect(page.getByText('Synthetic service unavailable')).toBeVisible();
 fail=false;await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByText('Synthetic service unavailable')).not.toBeVisible();
});
