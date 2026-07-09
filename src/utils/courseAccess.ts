/**
 * Course access & lesson locking utilities.
 *
 * Rules:
 *  - Both free and paid courses require enrollment.
 *  - Lesson 0 (first by sort_order) is always unlocked for enrolled users.
 *  - Subsequent lessons unlock only after the previous one is completed.
 */

export interface FlatLesson {
  id: string;
  sort_order: number;
}

/** Whether a specific lesson is unlocked for the user. */
export function isLessonUnlocked(
  lessonId: string,
  sortedLessons: FlatLesson[],
  completedLessons: Set<string>,
  enrolled: boolean,
): boolean {
  if (!enrolled) return false;

  const idx = sortedLessons.findIndex((l) => l.id === lessonId);
  if (idx < 0) return false;
  if (idx === 0) return true; // first lesson always accessible

  return completedLessons.has(sortedLessons[idx - 1].id);
}

/** Find the next lesson the user should continue with. */
export function getNextUnlockedLessonId(
  sortedLessons: FlatLesson[],
  completedLessons: Set<string>,
): string | null {
  for (let i = 0; i < sortedLessons.length; i++) {
    if (!completedLessons.has(sortedLessons[i].id)) {
      // Check if this lesson would be unlocked
      if (i === 0 || completedLessons.has(sortedLessons[i - 1].id)) {
        return sortedLessons[i].id;
      }
      return null; // gap – shouldn't happen with sequential completion
    }
  }
  return null; // all done
}
