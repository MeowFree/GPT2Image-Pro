import type { QueuePriority } from "@repo/shared/config/subscription-plan";

type QueueTask<T> = {
  id: number;
  userId: string;
  priority: QueuePriority;
  userConcurrency: number;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  run: () => Promise<T>;
  timeout?: ReturnType<typeof setTimeout>;
};

const PRIORITY_WEIGHT: Record<QueuePriority, number> = {
  normal: 0,
  priority: 1,
  highest: 2,
};

let nextTaskId = 1;
let running = 0;
const runningByUser = new Map<string, number>();
const queue: QueueTask<unknown>[] = [];

function getPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getGlobalConcurrency() {
  return getPositiveIntegerEnv("IMAGE_GENERATION_GLOBAL_CONCURRENCY", 500);
}

function getQueueTimeoutMs() {
  return getPositiveIntegerEnv("IMAGE_GENERATION_QUEUE_TIMEOUT_MS", 60_000);
}

function formatDuration(seconds: number) {
  if (seconds % 60 === 0) return `${seconds / 60} minute(s)`;
  return `${seconds} second(s)`;
}

function getQueuedTaskTimeoutError(
  task: Pick<QueueTask<unknown>, "userId" | "userConcurrency">,
  timeoutMs: number
) {
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  const userRunning = runningByUser.get(task.userId) || 0;
  if (userRunning >= task.userConcurrency) {
    return new Error(
      `Image generation concurrency limit reached for this plan. Your plan allows ${task.userConcurrency} concurrent image generation task(s); this queued request waited ${formatDuration(timeoutSeconds)} without a free slot.`
    );
  }

  return new Error(
    `Image generation queue is busy. This queued request waited ${formatDuration(timeoutSeconds)} without a free global slot. Please retry shortly.`
  );
}

function canStartTask(
  task: Pick<QueueTask<unknown>, "userId" | "userConcurrency">
) {
  return (
    running < getGlobalConcurrency() &&
    (runningByUser.get(task.userId) || 0) < task.userConcurrency
  );
}

function sortQueue() {
  queue.sort((a, b) => {
    const priorityDelta =
      PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    return priorityDelta || a.id - b.id;
  });
}

function removeQueuedTask(task: QueueTask<unknown>) {
  const index = queue.indexOf(task);
  if (index !== -1) {
    queue.splice(index, 1);
    return true;
  }
  return false;
}

function scheduleQueue() {
  sortQueue();

  for (let index = 0; index < queue.length; index += 1) {
    const task = queue[index];
    if (!task) continue;
    if (!canStartTask(task)) continue;

    queue.splice(index, 1);
    index -= 1;
    startTask(task);
  }
}

function startTask<T>(task: QueueTask<T>) {
  if (task.timeout) clearTimeout(task.timeout);
  running += 1;
  runningByUser.set(task.userId, (runningByUser.get(task.userId) || 0) + 1);

  task
    .run()
    .then(task.resolve, task.reject)
    .finally(() => {
      running -= 1;
      const userRunning = (runningByUser.get(task.userId) || 1) - 1;
      if (userRunning > 0) {
        runningByUser.set(task.userId, userRunning);
      } else {
        runningByUser.delete(task.userId);
      }
      scheduleQueue();
    });
}

export function withImageGenerationQueue<T>(
  options: {
    userId: string;
    priority: QueuePriority;
    userConcurrency: number;
    timeoutMs?: number;
  },
  run: () => Promise<T>
): Promise<T> {
  if (canStartTask(options)) {
    return new Promise<T>((resolve, reject) => {
      startTask({
        id: nextTaskId++,
        userId: options.userId,
        priority: options.priority,
        userConcurrency: options.userConcurrency,
        resolve,
        reject,
        run,
      });
    });
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutMs = options.timeoutMs || getQueueTimeoutMs();
    let task: QueueTask<T>;
    task = {
      id: nextTaskId++,
      userId: options.userId,
      priority: options.priority,
      userConcurrency: options.userConcurrency,
      resolve,
      reject,
      run,
      timeout: setTimeout(() => {
        if (removeQueuedTask(task as QueueTask<unknown>)) {
          reject(getQueuedTaskTimeoutError(task, timeoutMs));
        }
      }, timeoutMs),
    };

    queue.push(task as QueueTask<unknown>);
    scheduleQueue();
  });
}
