const byId = id => document.getElementById(id)

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function messageText(tag, className, text) {
  const node = element(tag, className)
  for (const [index, part] of text.split(/\*\*([^*]+)\*\*/g).entries()) {
    node.append(index % 2 ? element('strong', '', part) : document.createTextNode(part))
  }
  return node
}

let experiment
let selected
let version = 'final'
let running = false
const live = new Map()

const resultKey = (scenario, variant) => `${scenario.id}/${variant}`
const savedRun = (scenario, variant) => experiment.runs.find(run =>
  run.scenario.id === scenario.id && run.version === variant)

function notice(message, error = false) {
  const node = byId('notice')
  node.hidden = !message
  node.classList.toggle('error', error)
  node.textContent = message
}

function renderScenarios() {
  const items = experiment.scenarios.map((scenario, index) => {
    const button = element('button', 'scenario-button')
    button.type = 'button'
    button.dataset.scenario = scenario.id
    const label = element('span', 'scenario-label')
    label.append(
      element('strong', '', scenario.title),
      element('small', '', scenario.holdout ? 'Итоговая проверка' : 'Тест для улучшения'),
    )
    button.append(element('span', 'scenario-index', String(index + 1).padStart(2, '0')), label)
    button.addEventListener('click', () => {
      selected = scenario
      if (scenario.holdout) version = 'final'
      renderRun()
    })
    return button
  })
  byId('scenarios').replaceChildren(...items)
}

function renderComparison() {
  const tiles = experiment.scenarios.filter(scenario => !scenario.holdout).map(scenario => {
    const baseline = savedRun(scenario, 'initial').grade.total
    const final = savedRun(scenario, 'final').grade.total
    const delta = final - baseline
    const tile = element('div', 'comparison-tile')
    const numbers = element('div', 'comparison-numbers')
    numbers.append(
      element('span', 'old-score', baseline),
      element('span', 'score-arrow', '→'),
      element('strong', '', final),
      element('span', `delta ${delta < 0 ? 'negative' : ''}`, delta > 0 ? `+${delta}` : delta),
    )
    tile.append(element('span', 'comparison-label', scenario.title), numbers)
    return tile
  })
  byId('comparison').replaceChildren(...tiles)
}

function renderRating(grade) {
  const maximum = selected.criteria.length * 2
  const summary = element('div', 'score-summary')
  if (!grade.valid) {
    summary.classList.add('invalid')
    summary.append(element('strong', '', 'Прогон исключён'), element('p', '', grade.fidelity))
    byId('rating').replaceChildren(summary)
    return
  }

  const number = element('p', 'score-total')
  number.append(element('strong', '', grade.total), element('span', '', ` / ${maximum}`))
  const meter = element('div', 'score-meter')
  meter.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < maximum; i++) meter.append(element('span', i < grade.total ? 'filled' : ''))
  const score = element('div')
  score.append(number, meter)
  summary.append(score, element('p', 'takeaway', grade.takeaway))

  const items = selected.criteria.map((criterion, index) => {
    const mark = grade.criteria[index]
    const card = element('li', 'criterion')
    const heading = element('div', 'criterion-heading')
    heading.append(element('h4', '', criterion.title), element('span', 'mark', `${mark.score} / 2`))
    card.append(heading, element('p', '', mark.comment))
    if (mark.quote) {
      const citation = messageText('blockquote', 'evidence', `«${mark.quote}»`)
      const link = element('a', 'turn-link', `Реплика ${mark.turn}`)
      link.href = `#turn-${mark.turn}`
      citation.append(link)
      card.append(citation)
    }
    const detail = element('details', 'criterion-rule')
    detail.append(element('summary', '', 'Условие полного балла'), element('p', '', criterion.rule))
    card.append(detail)
    return card
  })
  const list = element('ol', 'criteria')
  list.append(...items)
  byId('rating').replaceChildren(summary, list)
}

function renderRun() {
  for (const button of byId('scenarios').children) {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === selected.id))
  }
  for (const name of ['initial', 'final']) {
    byId(name).setAttribute('aria-pressed', String(version === name))
  }
  byId('initial').disabled = selected.holdout
  byId('scenario-type').textContent = selected.holdout ? 'Итоговая проверка' : 'Тест для улучшения'
  byId('scenario-title').textContent = selected.title
  byId('scenario-goal').textContent = selected.goal
  byId('prompt').textContent = experiment[version]

  const currentLive = live.get(resultKey(selected, version))
  const { dialog, grade } = currentLive ?? savedRun(selected, version)
  byId('run-type').textContent = currentLive ? 'Новый прогон OpenAI' : `Архив · ${dialog.length} реплик`
  byId('saved').hidden = !currentLive
  const turns = dialog.map((message, index) => {
    const isBuyer = message.role === 'buyer'
    const turn = element('li', `turn ${message.role}`)
    turn.id = `turn-${index + 1}`
    const text = element('div', 'turn-content')
    text.append(
      element('div', 'turn-meta', isBuyer ? `${selected.client} · клиент` : 'Luna · продавец'),
      messageText('p', '', message.text),
    )
    turn.append(element('span', 'avatar', isBuyer ? selected.client[0] : 'Л'), text)
    return turn
  })
  byId('dialog').replaceChildren(...turns)
  renderRating(grade)
}

async function run() {
  if (running) return
  running = true
  byId('run').disabled = true
  const scenario = selected
  const variant = version
  const title = `${scenario.title} · ${variant === 'initial' ? 'исходный' : 'финальный'}`
  notice(`Выполняется прогон «${title}». Сначала диалог, затем оценка Sol.`)
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: scenario.id, version: variant }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    live.set(resultKey(scenario, variant), result)
    if (selected === scenario && version === variant) renderRun()
    notice(`Прогон «${title}» завершён.`)
  } catch (error) {
    notice(error.message, true)
  } finally {
    byId('run').disabled = false
    running = false
  }
}

async function init() {
  const response = await fetch('/api/experiment')
  if (!response.ok) throw new Error('Не удалось загрузить материалы эксперимента.')
  experiment = await response.json()
  selected = experiment.scenarios[0]

  const connection = byId('connection')
  connection.classList.toggle('offline', !experiment.canRun)
  byId('connection-text').textContent = experiment.canRun ? 'OpenAI настроен' : 'Архив эксперимента'
  connection.hidden = false
  byId('judge-model').textContent = experiment.models.sol
  byId('rubric').textContent = experiment.rubric
  byId('offer').replaceChildren(
    ...[...experiment.offer.courses, experiment.offer.rules].map(text => element('p', '', text)),
  )
  for (const name of ['initial', 'final']) {
    byId(name).addEventListener('click', () => { version = name; renderRun() })
  }
  byId('saved').addEventListener('click', () => {
    live.delete(resultKey(selected, version))
    renderRun()
  })
  byId('run').addEventListener('click', run)
  byId('run').hidden = !experiment.canRun
  renderScenarios()
  renderComparison()
  renderRun()
  byId('workspace').hidden = false
}

init().catch(error => notice(error.message, true))
