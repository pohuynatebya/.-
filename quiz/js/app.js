(() => {
  const manifest = window.QUIZ_MANIFEST || { title: 'Тесты', total: 0, modes: {} };
  const dataStore = window.QUIZ_DATA = window.QUIZ_DATA || {};

  const state = {
    mode: 'all',
    pool: [],
    quiz: [],
    index: 0,
    score: 0,
    started: false,
    locked: false,
    currentOrder: []
  };

  const el = {};
  const $ = (id) => document.getElementById(id);

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (dataStore[src]) return resolve();
      const existing = document.querySelector(`script[data-src="${CSS.escape(src)}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.dataset.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
      document.head.appendChild(s);
    });
  }

  async function loadMode(mode) {
    const cfg = manifest.modes[mode] || Object.values(manifest.modes)[0] || { chunks: [] };
    const chunks = cfg.chunks || [];
    await Promise.all(chunks.map(loadScript));
    const loaded = chunks.flatMap((src) => dataStore[src] || []);
    return loaded;
  }

  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function sample(array, count) {
    const arr = shuffle(array);
    return arr.slice(0, count);
  }

  function letterFromIndex(i) {
    return ['A', 'B', 'C', 'D', 'E', 'F'][i] || '?';
  }

  function renderHome() {
    el.app.innerHTML = `
      <section class="hero card">
        <div class="hero__top">
          <div>
            <p class="eyebrow">Тесты по философии</p>
            <h1>${escapeHtml(manifest.title || 'Тест')}</h1>
          </div>
        </div>

        <p class="hero__lead">
          Всего вопросов: <strong>${manifest.total || 0}</strong>.
          Выбирай блок или проходи всю базу. По умолчанию — <strong>30 вопросов</strong>.
        </p>

        <div class="stats-grid">
          <div class="stat">
            <span class="stat__value">${manifest.total || 0}</span>
            <span class="stat__label">всего вопросов</span>
          </div>
          ${manifest.modes?.set1 ? `
          <div class="stat">
            <span class="stat__value">${manifest.modes.set1.count}</span>
            <span class="stat__label">блок 1</span>
          </div>` : ''}
          ${manifest.modes?.set2 ? `
          <div class="stat">
            <span class="stat__value">${manifest.modes.set2.count}</span>
            <span class="stat__label">блок 2</span>
          </div>` : ''}
        </div>

        <div class="mode-grid">
          ${Object.entries(manifest.modes || {}).map(([key, cfg]) => `
            <button class="mode-card" data-mode="${key}">
              <span class="mode-card__title">${escapeHtml(cfg.label)}</span>
              <span class="mode-card__meta">${cfg.count} вопросов</span>
            </button>
          `).join('')}
        </div>

        <div class="launch-row">
          <label class="field">
            <span class="field__label">Количество вопросов</span>
            <input id="countInput" type="number" min="1" max="${manifest.total || 100}" value="30" inputmode="numeric">
          </label>

          <button class="primary-btn" id="startBtn" type="button">Начать тест</button>
        </div>

        <p class="muted">После старта вопросы идут случайно. Можно завершить тест досрочно в любой момент.</p>
      </section>
    `;

    document.querySelectorAll('.mode-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.mode);
      btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        document.querySelectorAll('.mode-card').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    $('startBtn').onclick = startQuiz;
  }

  function renderLoading(text = 'Загрузка вопросов…') {
    el.app.innerHTML = `
      <section class="card center">
        <div class="spinner"></div>
        <h2>${escapeHtml(text)}</h2>
        <p class="muted">Подождите немного, идет подготовка теста.</p>
      </section>
    `;
  }

  function renderQuestion() {
    const q = state.quiz[state.index];
    const total = state.quiz.length;
    const progress = Math.round(((state.index) / total) * 100);
    const answered = state.quiz.filter(x => x.userSelected !== undefined).length;
    const correct = state.quiz.filter(x => x.userSelected !== undefined && x.userSelected === x.answerIndex).length;

    el.app.innerHTML = `
      <section class="card">
        <div class="quiz-top">
          <div>
            <p class="eyebrow">Вопрос ${state.index + 1} из ${total}</p>
            <h2 class="quiz-question">${escapeHtml(q.question)}</h2>
          </div>
          <button class="ghost-btn" id="endEarlyBtn" type="button">Завершить тест</button>
        </div>

        <div class="progress-wrap" aria-hidden="true">
          <div class="progress-bar">
            <div class="progress-bar__fill" style="width:${progress}%"></div>
          </div>
          <div class="progress-meta">
            <span>Отвечено: ${answered}</span>
            <span>Верно: ${correct}</span>
          </div>
        </div>

        <div class="options-grid" id="optionsGrid">
          ${state.currentOrder.map((opt, idx) => `
            <button class="option-btn" data-idx="${idx}" type="button">
              <span class="option-btn__letter">${opt.letter}</span>
              <span class="option-btn__text">${escapeHtml(opt.text)}</span>
            </button>
          `).join('')}
        </div>

        <div class="feedback" id="feedback" hidden></div>

        <div class="actions-row">
          <button class="ghost-btn" id="prevBtn" type="button" ${state.index === 0 ? 'hidden' : ''}>Назад</button>
          <button class="ghost-btn" id="backHomeBtn" type="button">На главную</button>
          <button class="primary-btn" id="nextBtn" type="button" hidden>Следующий вопрос</button>
        </div>
      </section>
    `;

    $('backHomeBtn').onclick = () => {
      if (confirm('Вернуться на главную? Текущий прогресс будет сброшен.')) {
        state.started = false;
        state.quiz = [];
        state.index = 0;
        state.score = 0;
        state.locked = false;
        renderHome();
      }
    };

    $('endEarlyBtn').onclick = finishQuiz;
    $('nextBtn').onclick = nextQuestion;
    $('prevBtn').onclick = prevQuestion;

    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.onclick = () => chooseAnswer(Number(btn.dataset.idx));
    });

    // Если мы вернулись к уже отвеченному вопросу - восстанавливаем его состояние
    if (q.userSelected !== undefined) {
      state.locked = true;
      const chosenIdx = state.currentOrder.findIndex(o => o.originalIndex === q.userSelected);
      applyAnswerVisuals(chosenIdx);
    } else {
      state.locked = false;
    }
  }

  // Вынес визуализацию ответа в отдельную функцию для переиспользования
  function applyAnswerVisuals(chosenIdx) {
    const q = state.quiz[state.index];
    const chosen = state.currentOrder[chosenIdx];
    
    const buttons = [...document.querySelectorAll('.option-btn')];
    buttons.forEach((btn, i) => {
      btn.disabled = true; // Блокируем кнопки, если ответ уже дан
      if (i === q.shuffledAnswerIndex) btn.classList.add('correct');
      if (i === chosenIdx && chosenIdx !== q.shuffledAnswerIndex) btn.classList.add('wrong');
    });

    const feedback = $('feedback');
    const nextBtn = $('nextBtn');
    feedback.hidden = false;
    
    if (chosen && chosen.isCorrect) {
      feedback.innerHTML = `<strong>Верно.</strong> ${escapeHtml(chosen.text)}`;
    } else {
      const correctOpt = state.currentOrder[q.shuffledAnswerIndex];
      feedback.innerHTML = `<strong>Неверно.</strong> Правильный ответ: <b>${correctOpt.letter}</b> — ${escapeHtml(correctOpt.text)}`;
    }
    
    nextBtn.hidden = false;
    if (state.index === state.quiz.length - 1) {
      nextBtn.textContent = 'Показать результат';
    } else {
      nextBtn.textContent = 'Следующий вопрос';
    }
  }

  function chooseAnswer(idx) {
    if (state.locked) return;
    state.locked = true;

    const q = state.quiz[state.index];
    const chosen = state.currentOrder[idx];
    
    // Сохраняем оригинальный индекс для истории
    q.userSelected = chosen.originalIndex;

    applyAnswerVisuals(idx);
  }

  function nextQuestion() {
    const q = state.quiz[state.index];
    if (q.userSelected === undefined) return;
    state.index += 1;

    if (state.index >= state.quiz.length) {
      finishQuiz();
      return;
    }

    prepareCurrentOrder();
    renderQuestion();
  }

  function prevQuestion() {
    if (state.index > 0) {
      state.index -= 1;
      prepareCurrentOrder();
      renderQuestion();
    }
  }

  function prepareCurrentOrder() {
    const q = state.quiz[state.index];
    const opts = q.options.map((opt, idx) => ({
      ...opt,
      originalIndex: idx,
      isCorrect: idx === q.answerIndex,
      letter: opt.letter || letterFromIndex(idx)
    }));
    
    // Ответы всегда остаются в оригинальном порядке
    state.currentOrder = opts;
    q.shuffledAnswerIndex = state.currentOrder.findIndex(o => o.isCorrect);
  }

  function computeResults() {
    const answered = state.quiz.filter(x => x.userSelected !== undefined);
    const correct = answered.filter(x => x.userSelected === x.answerIndex).length;
    const skipped = state.quiz.length - answered.length;
    return { answered: answered.length, correct, skipped, total: state.quiz.length };
  }

  function finishQuiz() {
    const { answered, correct, skipped, total } = computeResults();
    const percent = total ? Math.round((correct / total) * 100) : 0;
    const mistakes = state.quiz
      .filter(q => q.userSelected !== undefined && q.userSelected !== q.answerIndex)
      .map(q => ({
        number: q.number || (state.quiz.indexOf(q) + 1),
        question: q.question,
        correctLetter: q.options[q.answerIndex].letter || letterFromIndex(q.answerIndex),
        correctText: q.options[q.answerIndex].text,
        chosenLetter: q.options[q.userSelected].letter || letterFromIndex(q.userSelected),
        chosenText: q.options[q.userSelected].text,
      }));

    el.app.innerHTML = `
      <section class="card result-card">
        <p class="eyebrow">Результат</p>
        <h2>${correct} из ${total}</h2>
        <p class="result-percentage">${percent}%</p>

        <div class="stats-grid stats-grid--result">
          <div class="stat">
            <span class="stat__value">${answered}</span>
            <span class="stat__label">отвечено</span>
          </div>
          <div class="stat">
            <span class="stat__value">${correct}</span>
            <span class="stat__label">верно</span>
          </div>
          <div class="stat">
            <span class="stat__value">${skipped}</span>
            <span class="stat__label">пропущено</span>
          </div>
        </div>

        ${mistakes.length ? `
          <div class="mistakes">
            <h3>Ошибки</h3>
            <div class="mistakes-list">
              ${mistakes.slice(0, 25).map(m => `
                <article class="mistake">
                  <div class="mistake__head">
                    <strong>Вопрос ${m.number}</strong>
                    <span>${m.chosenLetter} → ${m.correctLetter}</span>
                  </div>
                  <p>${escapeHtml(m.question)}</p>
                  <p class="mistake__answer"><b>Правильно:</b> ${m.correctLetter} — ${escapeHtml(m.correctText)}</p>
                </article>
              `).join('')}
            </div>
            ${mistakes.length > 25 ? `<p class="muted">Показаны первые 25 ошибок.</p>` : ''}
          </div>
        ` : `
          <div class="success-note">Отличный результат — ошибок нет.</div>
        `}

        <div class="actions-row">
          <button class="primary-btn" id="restartBtn" type="button">Пройти заново</button>
          <button class="ghost-btn" id="homeFromResultBtn" type="button">На главную</button>
        </div>
      </section>
    `;

    $('restartBtn').onclick = restartQuiz;
    $('homeFromResultBtn').onclick = () => {
      state.started = false;
      state.quiz = [];
      state.index = 0;
      state.score = 0;
      state.locked = false;
      renderHome();
    };
  }

  function restartQuiz() {
    state.started = false;
    state.quiz = [];
    state.index = 0;
    state.score = 0;
    state.locked = false;
    startQuiz();
  }

  async function startQuiz() {
    const countInput = $('countInput');
    let count = parseInt(countInput?.value || '30', 10);
    if (!Number.isFinite(count) || count < 1) count = 30;

    renderLoading();

    const pool = await loadMode(state.mode);
    state.pool = pool;

    const max = pool.length;
    count = Math.min(count, max);
    if (countInput) countInput.value = String(count);

    state.quiz = sample(pool, count).map(q => ({
      ...q,
      userSelected: undefined,
    }));
    state.index = 0;
    state.locked = false;
    state.started = true;
    prepareCurrentOrder();
    renderQuestion();
  }

  function init() {
    el.app = $('app');
    renderHome();
  }

  document.addEventListener('DOMContentLoaded', init);
})();