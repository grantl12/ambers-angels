import { chromium } from 'playwright'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const grantsDir = resolve(root, 'grants')
const outDir = resolve(grantsDir, 'pdfs')

mkdirSync(outDir, { recursive: true })

const docs = [
  { file: 'FOUNDER_SERVICES_AGREEMENT.html', out: 'Founder_Services_Agreement.pdf' },
  { file: 'TIMESHEET.html',                  out: 'Timesheet_InKind_2026.pdf'       },
  { file: 'EXPENSES.html',                   out: 'Expense_Log_2026.pdf'            },
  { file: 'SALARY_BENCHMARK.html',           out: 'Salary_Benchmark.pdf'            },
]

const browser = await chromium.launch()
const page = await browser.newPage()

for (const doc of docs) {
  const src = `file:///${resolve(grantsDir, doc.file).replace(/\\/g, '/')}`
  const dest = resolve(outDir, doc.out)

  await page.goto(src, { waitUntil: 'networkidle' })

  await page.pdf({
    path: dest,
    format: 'Letter',
    margin: { top: '0.75in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:9px;color:#aaa;width:100%;text-align:center;font-family:Georgia,serif;">
      Amber's Angels, Inc. &nbsp;·&nbsp; EIN 42-2052151 &nbsp;·&nbsp; Confidential
    </div>`,
    footerTemplate: `<div style="font-size:9px;color:#aaa;width:100%;text-align:center;font-family:Georgia,serif;">
      Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>`,
  })

  console.log(`✅  ${doc.out}`)
}

await browser.close()
console.log(`\nPDFs saved to grants/pdfs/`)
