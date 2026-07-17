"use client";

import { useEffect, useMemo, useState } from "react";

type Problem = {
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topic: string;
  minutes: number;
  url: string;
};

const problems: Problem[] = [
  {
    title: "Number of Islands",
    difficulty: "Medium",
    topic: "Graph · DFS",
    minutes: 25,
    url: "https://leetcode.com/problems/number-of-islands/",
  },
  {
    title: "Top K Frequent Elements",
    difficulty: "Medium",
    topic: "Heap · Bucket sort",
    minutes: 25,
    url: "https://leetcode.com/problems/top-k-frequent-elements/",
  },
  {
    title: "Merge Intervals",
    difficulty: "Medium",
    topic: "Intervals · Sorting",
    minutes: 25,
    url: "https://leetcode.com/problems/merge-intervals/",
  },
  {
    title: "LRU Cache",
    difficulty: "Medium",
    topic: "Design · Linked list",
    minutes: 40,
    url: "https://leetcode.com/problems/lru-cache/",
  },
  {
    title: "Kth Largest Element",
    difficulty: "Medium",
    topic: "Heap · Quickselect",
    minutes: 30,
    url: "https://leetcode.com/problems/kth-largest-element-in-an-array/",
  },
  {
    title: "Decode String",
    difficulty: "Medium",
    topic: "Stack · Recursion",
    minutes: 25,
    url: "https://leetcode.com/problems/decode-string/",
  },
];

const starterCode = `class Solution:
    def numIslands(self, grid: List[List[str]]) -> int:
        # Write your solution here
        
        return 0`;

function formatTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [contestMode, setContestMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(3 * 60 * 60);
  const [activeProblem, setActiveProblem] = useState(0);
  const [solved, setSolved] = useState<number[]>([]);
  const [code, setCode] = useState(starterCode);
  const [consoleMessage, setConsoleMessage] = useState(
    "Run your code to see test results."
  );

  useEffect(() => {
    if (!running || timeLeft <= 0) return;
    const timer = window.setInterval(() => {
      setTimeLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, timeLeft]);

  useEffect(() => {
    const savedCode = window.localStorage.getItem("interview-arc-code");
    if (savedCode) setCode(savedCode);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("interview-arc-code", code);
  }, [code]);

  const totalMinutes = useMemo(
    () => problems.reduce((sum, problem) => sum + problem.minutes, 0),
    []
  );

  function startSprint() {
    setContestMode(true);
    setRunning(true);
  }

  function submitProblem() {
    setSolved((current) =>
      current.includes(activeProblem) ? current : [...current, activeProblem]
    );
    setConsoleMessage("Attempt saved. Review the official editorial after the sprint.");
  }

  if (contestMode) {
    const problem = problems[activeProblem];

    return (
      <main className="contest-shell">
        <header className="contest-header">
          <button className="brand brand-button" onClick={() => setContestMode(false)} aria-label="Return to dashboard">
            <span className="brand-mark">IA</span>
            <span>Interview Arc</span>
          </button>
          <div className="contest-title">
            <span className="live-dot" />
            Coding sprint · Day 24
          </div>
          <div className="contest-actions">
            <span className="header-timer">{formatTime(timeLeft)}</span>
            <button className="ghost-button" onClick={() => setRunning((value) => !value)}>
              {running ? "Pause" : "Resume"}
            </button>
            <button className="end-button" onClick={() => setContestMode(false)}>End sprint</button>
          </div>
        </header>

        <div className="contest-workspace">
          <aside className="problem-rail" aria-label="Coding problems">
            <div className="rail-heading">
              <span>Problems</span>
              <span>{solved.length}/6</span>
            </div>
            {problems.map((item, index) => (
              <button
                key={item.title}
                className={`problem-tab ${activeProblem === index ? "active" : ""}`}
                onClick={() => setActiveProblem(index)}
              >
                <span className={`problem-number ${solved.includes(index) ? "solved" : ""}`}>
                  {solved.includes(index) ? "✓" : index + 1}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.difficulty} · {item.minutes} min</small>
                </span>
              </button>
            ))}
            <div className="rail-tip">
              <strong>Contest rule</strong>
              No editorials until the timer ends. Save questions and keep moving.
            </div>
          </aside>

          <section className="problem-pane">
            <div className="problem-toolbar">
              <div>
                <span className="eyebrow">Problem {activeProblem + 1} of 6</span>
                <h1>{problem.title}</h1>
              </div>
              <a className="leetcode-link" href={problem.url} target="_blank" rel="noreferrer">
                Open on LeetCode ↗
              </a>
            </div>
            <div className="problem-meta">
              <span className="difficulty medium">{problem.difficulty}</span>
              <span>{problem.topic}</span>
              <span>Target · {problem.minutes} min</span>
            </div>
            <div className="prompt-card">
              <div className="prompt-icon">↗</div>
              <div>
                <strong>Solve from the original source</strong>
                <p>Open the LeetCode prompt in a second tab, then write and time your attempt here. This keeps the workspace focused without copying protected problem content.</p>
              </div>
            </div>
            <div className="scratch-notes">
              <span className="scratch-label">Quick plan</span>
              <textarea aria-label="Quick solution plan" placeholder="1. Clarify edge cases&#10;2. Choose the data structure&#10;3. State time and space complexity" />
            </div>
          </section>

          <section className="editor-pane">
            <div className="editor-toolbar">
              <div className="editor-tabs">
                <button className="editor-tab active">solution.py</button>
                <button className="editor-tab">notes.md</button>
              </div>
              <select aria-label="Programming language" defaultValue="python">
                <option value="python">Python 3</option>
                <option value="java">Java 21</option>
                <option value="typescript">TypeScript</option>
              </select>
            </div>
            <div className="code-wrap">
              <div className="line-numbers" aria-hidden="true">1<br />2<br />3<br />4<br />5</div>
              <textarea
                className="code-editor"
                aria-label="Code editor"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="console-panel">
              <div className="console-heading">
                <span>Test console</span>
                <span className="autosaved">● Autosaved locally</span>
              </div>
              <p>{consoleMessage}</p>
            </div>
            <div className="editor-actions">
              <button className="run-button" onClick={() => setConsoleMessage("Prototype mode: local code execution comes in Phase 2.")}>▷ Run</button>
              <button className="submit-button" onClick={submitProblem}>Submit attempt</button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">IA</span>
          <span>Interview Arc</span>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a className="nav-item active" href="#today"><Icon>⌂</Icon>Today</a>
          <a className="nav-item" href="#journey"><Icon>⌁</Icon>Journey</a>
          <a className="nav-item" href="#question-bank"><Icon>◇</Icon>Question bank</a>
          <a className="nav-item" href="#reviews"><Icon>✓</Icon>Reviews</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="streak-card">
            <span className="streak-flame">↗</span>
            <div><strong>18 day streak</strong><small>Personal best: 23</small></div>
          </div>
          <a className="nav-item" href="#settings"><Icon>⚙</Icon>Settings</a>
          <div className="profile">
            <span className="avatar">WX</span>
            <div><strong>Wenk Xu</strong><small>Interviewing · 2026</small></div>
            <span>•••</span>
          </div>
        </div>
      </aside>

      <section className="dashboard" id="today">
        <header className="topbar">
          <div>
            <span className="date-label">THURSDAY, JULY 16</span>
            <h1>Good morning, Wenk.</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Search">⌕</button>
            <button className="icon-button notification" aria-label="Notifications">♢</button>
            <button className="plan-button">Edit today&apos;s plan</button>
          </div>
        </header>

        <section className="focus-banner">
          <div>
            <span className="banner-kicker">DAY 24 · GRAPH WEEK</span>
            <h2>Build fluency,<br /><em>not just streaks.</em></h2>
            <p>Six focused problems, one system design deep dive, and one story worth remembering.</p>
          </div>
          <div className="focus-visual" aria-hidden="true">
            <span className="orbit orbit-one" />
            <span className="orbit orbit-two" />
            <span className="focus-number">24</span>
            <span className="focus-caption">days<br />in motion</span>
          </div>
        </section>

        <div className="section-heading">
          <div><span className="eyebrow">TODAY&apos;S PLAN</span><h2>Your interview circuit</h2></div>
          <span className="total-time">4 hr 15 min total</span>
        </div>

        <section className="task-grid">
          <article className="task-card coding-card">
            <div className="task-card-header">
              <span className="task-icon coding-icon">⌘</span>
              <div className="task-tags"><span className="tag required">REQUIRED</span><span>3 hours</span></div>
            </div>
            <div className="task-copy">
              <span className="task-index">01 / CODING</span>
              <h3>Timed coding sprint</h3>
              <p>Six medium problems across graphs, heaps, intervals, and data structure design.</p>
            </div>
            <div className="mini-problem-list">
              {problems.slice(0, 3).map((problem, index) => (
                <div key={problem.title}><span>0{index + 1}</span><strong>{problem.title}</strong><small>{problem.minutes}m</small></div>
              ))}
              <div className="more-row"><span>+3</span><strong>More problems</strong><small>{totalMinutes}m set</small></div>
            </div>
            <button className="primary-button" onClick={startSprint}>Start 3-hour sprint <span>→</span></button>
          </article>

          <article className="task-card design-card">
            <div className="task-card-header">
              <span className="task-icon design-icon">△</span>
              <div className="task-tags"><span className="tag coach">COACH MODE</span><span>45 min</span></div>
            </div>
            <div className="task-copy">
              <span className="task-index">02 / SYSTEM DESIGN</span>
              <h3>Design a notification system</h3>
              <p>Scale a TikTok-style notification pipeline from requirements to failure recovery.</p>
            </div>
            <div className="design-steps">
              <span className="done">✓</span><i /><span>2</span><i /><span>3</span><i /><span>4</span>
            </div>
            <div className="progress-copy"><span>Step 1 of 4</span><span>Clarify requirements</span></div>
            <button className="secondary-button">Continue coaching <span>→</span></button>
          </article>

          <article className="task-card behavioral-card">
            <div className="task-card-header">
              <span className="task-icon behavior-icon">◎</span>
              <div className="task-tags"><span className="tag speak">SPEAK ALOUD</span><span>30 min</span></div>
            </div>
            <div className="task-copy">
              <span className="task-index">03 / BEHAVIORAL</span>
              <h3>Disagree & commit</h3>
              <p>Tell me about a time you disagreed with a technical decision. What did you do?</p>
            </div>
            <div className="record-box">
              <button className="record-button" aria-label="Start voice recording"><span>●</span></button>
              <div><strong>Record your answer</strong><small>Target 2–3 minutes · STAR format</small></div>
            </div>
            <button className="secondary-button">Open story workspace <span>→</span></button>
          </article>
        </section>

        <section className="bottom-grid" id="journey">
          <article className="journey-card">
            <div className="card-title-row"><div><span className="eyebrow">YOUR JOURNEY</span><h3>Consistency is compounding.</h3></div><button>Last 30 days⌄</button></div>
            <div className="journey-content">
              <div className="big-stat"><strong>76%</strong><span>completion</span><small>↑ 12% from last month</small></div>
              <div className="heatmap" aria-label="Practice activity heatmap">
                {Array.from({ length: 42 }).map((_, index) => <span key={index} className={`heat heat-${(index * 7 + index % 5) % 5}`} />)}
              </div>
              <div className="journey-metrics"><span><strong>104</strong>problems</span><span><strong>16</strong>designs</span><span><strong>28</strong>stories</span></div>
            </div>
          </article>
          <article className="review-card" id="reviews">
            <div className="card-title-row"><div><span className="eyebrow">NEXT REVIEW</span><h3>Close the loop.</h3></div><span className="review-count">4 due</span></div>
            <div className="review-item"><span className="review-date">JUL<br /><strong>18</strong></span><div><strong>LRU Cache</strong><small>Missed edge case · revisit notes</small></div><span>→</span></div>
            <div className="review-item"><span className="review-date">JUL<br /><strong>19</strong></span><div><strong>News Feed fanout</strong><small>Tradeoffs need a crisper summary</small></div><span>→</span></div>
          </article>
        </section>
      </section>
    </main>
  );
}
