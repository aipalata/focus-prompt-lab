import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { models, prepare, runDialog, evaluate, optimize } from '../lab.mjs'

const [mode, previousArchive, workDirectory, ...extra] = process.argv.slice(2)
const repeating = mode === '--repeat' && previousArchive && workDirectory && !extra.length
if (mode && !repeating) {
  console.error('Использование: node scripts/experiment.mjs [--repeat <архив JSON> <папка прогонов>]')
  process.exit(1)
}
const outputDirectory = repeating
  ? resolve(workDirectory)
  : fileURLToPath(new URL('../data/', import.meta.url))
const dataFile = name => join(outputDirectory, `${name}.json`)

async function save(name, data) {
  const staging = dataFile(`${name}.tmp`)
  await writeFile(staging, JSON.stringify(data, null, 2) + '\n')
  await rename(staging, dataFile(name))
}

async function saved(name, create) {
  const existing = await readFile(dataFile(name), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing) return JSON.parse(existing)
  const result = await create()
  await save(name, result)
  return result
}

async function gradeDialog(scenario, dialog) {
  for (let check = 1; ; check++) {
    try {
      return await evaluate(scenario, dialog)
    } catch (error) {
      if (check === 3 || !error.message.includes('цитату')) throw error
    }
  }
}

async function collect(scenario, version, prompt) {
  return saved(`${scenario.id}-${version}`, async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const dialog = await saved(`${scenario.id}-${version}-dialog-${attempt}`,
        () => runDialog(scenario, prompt))
      const grade = await gradeDialog(scenario, dialog)
      console.log(`${scenario.id} / ${version}: ${grade.valid ? grade.total : 'невалиден'}`)
      if (grade.valid) return { scenario, version, dialog, grade, attempt }
      await save(`${scenario.id}-${version}-invalid-${attempt}`, grade)
    }
    throw new Error(`Клиент нарушил условия сценария ${scenario.id} в трёх попытках.`)
  })
}

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  const hasArchive = await access(dataFile('experiment')).then(() => true, error => {
    if (error.code === 'ENOENT') return false
    throw error
  })
  if (hasArchive) {
    console.log('Сохранённый эксперимент уже завершён.')
    return
  }

  const previous = repeating ? JSON.parse(await readFile(previousArchive, 'utf8')) : null
  const materials = await saved('materials', () => previous ? {
    initial: previous.initial, scenarios: previous.scenarios, offer: previous.offer, models,
  } : prepare())
  if (materials.models.sol !== models.sol) {
    throw new Error('Для этой версии Sol укажите новую папку прогонов.')
  }
  console.log(previous ? 'Сохранены исходные материалы Terra.' : 'Материалы Terra зафиксированы.')
  const comparison = previous && Promise.allSettled(previous.runs.map(run => saved(
    `previous-${run.scenario.id}-${run.version}`, async () => {
      const grade = await gradeDialog(run.scenario, run.dialog)
      console.log(`Архив ${run.scenario.id} / ${run.version}: ${run.grade.total} → ${grade.valid ? grade.total : 'невалиден'}`)
      return { scenarioId: run.scenario.id, version: run.version, previousGrade: run.grade, grade }
    },
  )))
  const training = materials.scenarios.filter(scenario => !scenario.holdout)
  const baseline = await Promise.all(training.map(scenario => collect(scenario, 'initial', materials.initial)))
  const optimization = await saved('optimization', () => optimize(materials.initial, baseline))
  console.log('Финальный промпт Sol зафиксирован.')
  const retest = await Promise.all(training.map(scenario => collect(scenario, 'final', optimization.final)))
  const holdout = await collect(materials.scenarios.find(scenario => scenario.holdout), 'final', optimization.final)
  const checks = comparison && await comparison
  if (checks) {
    const failure = checks.find(check => check.status === 'rejected')
    if (failure) throw failure.reason
  }
  await save('experiment', {
    ...materials, ...optimization,
    runs: [...baseline, ...retest, holdout],
    ...(checks && { comparison: { previousModel: previous.models.sol, runs: checks.map(check => check.value) } }),
  })
  console.log('Эксперимент сохранён.')
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
