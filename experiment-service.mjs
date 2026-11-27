import experiment from './data/experiment.json' with { type: 'json' }
import { evaluate, LabError, rubric, runDialog } from './lab.mjs'

function canRun() {
  const deadline = process.env.OPENAI_RUNS_UNTIL
  return Boolean(process.env.OPENAI_API_KEY) && (!deadline || Date.now() < Date.parse(deadline))
}

export function experimentView() {
  return { ...experiment, rubric, canRun: canRun() }
}

const errorResult = (status, error) => ({ status, body: { error } })

let running = false

export async function runSelectedScenario(input) {
  const scenario = experiment.scenarios.find(item => item.id === input?.scenario)
  const version = input?.version
  if (!scenario || !['initial', 'final'].includes(version) || (scenario.holdout && version !== 'final')) {
    return errorResult(400, 'Для этого сценария версия недоступна.')
  }
  if (!canRun()) return errorResult(503, 'Новые прогоны OpenAI сейчас недоступны. Сохранённые диалоги можно открыть в архиве.')
  if (running) return errorResult(409, 'Дождитесь завершения текущего прогона.')

  running = true
  try {
    const dialog = await runDialog(scenario, experiment[version])
    const grade = await evaluate(scenario, dialog)
    return { status: 200, body: { version, dialog, grade } }
  } catch (error) {
    if (error instanceof LabError) return errorResult(502, error.message)
    console.error('Ошибка прогона', error.code ?? error.name)
    return errorResult(500, 'Приложение не смогло обработать запрос.')
  } finally {
    running = false
  }
}
