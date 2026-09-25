/* Durable queue of application reviews that are waiting for their timer (see socialApplications.js). */
import { mutateJson, paths, readJson } from '../../utils/storage.js';

const MAX_ATTEMPTS = 5;

export function addPendingReview(review) {
  return mutateJson(paths.pendingReviews, [], (rows) => {
    if (!rows.some((row) => row.id === review.id)) rows.push(review);
  });
}

/* Reviews that have failed too many times are dropped instead of retrying forever. */
export async function listPendingReviews() {
  const rows = await readJson(paths.pendingReviews, []);
  return Array.isArray(rows) ? rows.filter((row) => row && row.id && (row.attempts || 0) < MAX_ATTEMPTS) : [];
}

export function removePendingReview(id) {
  return mutateJson(paths.pendingReviews, [], (rows) => {
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows.splice(index, 1);
  });
}

export function bumpReviewAttempt(id) {
  return mutateJson(paths.pendingReviews, [], (rows) => {
    const row = rows.find((entry) => entry.id === id);
    if (!row) return 0;
    row.attempts = (row.attempts || 0) + 1;
    return row.attempts;
  });
}
