/**
 * 冒烟:编辑台播放时,左栏卡片列表要跟着播放进度高亮当前卡。
 * 用法(先起服务):npx vite preview --port 5199
 *                 node scripts/smoke-playing-highlight.mjs
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const URL = process.env.SMOKE_URL ?? 'http://localhost:5199/'
// 没跑过 `npx puppeteer browsers install` 时,puppeteer 自带的 Chrome 不存在,
// 退回系统装的浏览器。CHROME_PATH 可手动指定;Windows / macOS 各列几个常见位置。
const CHROME =
  process.env.CHROME_PATH ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].find((p) => fs.existsSync(p))
if (!CHROME) {
  console.error(
    '找不到浏览器。跑一次 `npx puppeteer browsers install chrome`,\n' +
      '或用 CHROME_PATH=/path/to/chrome 指定本机浏览器。',
  )
  process.exit(1)
}
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox'],
  executablePath: CHROME,
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 950 })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push(String(e)))
// 首次打开会问「载入示例吗」—— 接受,顺便就有卡片了
page.on('dialog', async (d) => { await d.accept() })

await page.goto(URL, { waitUntil: 'networkidle2' })
// 第一次运行要先点「同意」协议,否则 App 压根不渲染
const eula = await page.$('.eula-btn')
if (eula) {
  // 「同意」按钮要滚到协议底部才亮(clickwrap),先滚
  await page.evaluate(() => {
    const b = document.querySelector('.eula-body')
    if (b) b.scrollTop = b.scrollHeight
  })
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.eula-btn')
      return btn && !btn.disabled
    },
    { timeout: 5000 },
  )
  await page.click('.eula-btn')
  await page.waitForFunction(() => !document.querySelector('.eula'), { timeout: 5000 })
}
await page.waitForSelector('.fx-item--row', { timeout: 15000 })
const total = await page.$$eval('.fx-item--row', (n) => n.length)
console.log('卡片数:', total)

// 空格播放
await page.keyboard.press('Space')
await new Promise((r) => setTimeout(r, 1500))

const snap = () =>
  page.evaluate(() => {
    const on = [...document.querySelectorAll('.fx-item--row')].filter((e) =>
      e.classList.contains('is-playing'),
    )
    const px = (e) => ({
      id: e.dataset.cardId,
      name: e.querySelector('.fx-name')?.textContent?.trim(),
      lead: e.classList.contains('is-lead'),
      prog: e.querySelector('.fx-prog')?.style.width ?? null,
      progOpacity: e.querySelector('.fx-prog')
        ? getComputedStyle(e.querySelector('.fx-prog')).opacity
        : null,
      tri: !!e.querySelector('.fx-play'),
      bg: getComputedStyle(e).backgroundColor,
    })
    return {
      playing: on.map(px),
      lead: on.filter((e) => e.classList.contains('is-lead')).map(px),
      sel: document.querySelector('.fx-item--row.is-on')?.dataset.cardId ?? null,
    }
  })

const a = await snap()
console.log('播放 1.5s 时:', JSON.stringify(a, null, 2))
await new Promise((r) => setTimeout(r, 2500))
const b = await snap()
console.log('再过 2.5s:', JSON.stringify(b, null, 2))
console.log(
  '进度有推进:',
  a.playing[0]?.prog !== b.playing[0]?.prog || a.playing[0]?.id !== b.playing[0]?.id,
)

// 暂停后仍应保留高亮(拖播放头/暂停时也要知道是哪张)
await page.keyboard.press('Space')
await new Promise((r) => setTimeout(r, 400))
const c = await snap()
console.log('暂停后:', JSON.stringify(c.playing.map((x) => x.id)))

// 截图:肉眼确认一下高亮和进度线的样子
await page.screenshot({ path: 'exports/smoke-playing-highlight.png' })
console.log('截图:exports/smoke-playing-highlight.png')

console.log('控制台报错:', errs.length ? errs : '无')
await browser.close()
