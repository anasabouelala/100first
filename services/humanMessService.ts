/**
 * Human Mess Service: Generates context-aware, relatable "Indie Hacker" struggles.
 */

interface MessCategory {
  title: string;
  messages: string[];
}

const MESS_CATEGORIES: Record<string, MessCategory> = {
  MORNING: {
    title: "Caffeine & Starts",
    messages: [
      "Spilled a full cup of coffee on my desk at 8 AM. Keyboard survived, but my soul is stained.",
      "Completely ran out of oat milk. Drinking black coffee like a barbarian while I refactor the backend.",
      "Spent 2 hours trying to find a bug, only to realize I hadn't turned the server on. Morning vibes.",
      "My breakfast was a cold protein bar and a dream."
    ]
  },
  AFTERNOON: {
    title: "The Mid-Day Slump",
    messages: [
      "Accidentally took a '20-minute nap' that lasted 3 hours. Woke up in another dimension.",
      "The post-lunch crash is hitting hard. Building this in a haze of carb-induced lethargy.",
      "My neighbor started drilling a hole in the wall the exact second I started deep work.",
      "Fighting the urge to delete everything and move to a farm."
    ]
  },
  EVENING: {
    title: "The Late Night Grind",
    messages: [
      "It's 11 PM and I'm talking to my code. It hasn't talked back yet, which is a good sign.",
      "Laptop is hot enough to fry an egg. I'm using it as a space heater while I ship this feature.",
      "Living on energy drinks and spite at this point.",
      "Just realized I haven't left my chair since noon. My legs are a myth."
    ]
  },
  DEEP_WORK: {
    title: "The Zone",
    messages: [
      "Lost track of time so badly I missed a family dinner. Shipped X but lost my social status.",
      "I have 42 tabs open and I'm pretty sure one of them is playing music, but I can't find it.",
      "My eye has been twitching for 3 hours. It's binary for 'keep shipping'.",
      "I'm pretty sure I'm a professional Googler who occasionally writes loops."
    ]
  }
};

/**
 * Returns a relatable human struggle based on the current hour.
 */
export const generateAutomatedMess = (commitCount: number = 0): string => {
  const hour = new Date().getHours();
  let category: MessCategory;

  if (commitCount > 10) {
    category = MESS_CATEGORIES.DEEP_WORK;
  } else if (hour >= 5 && hour < 12) {
    category = MESS_CATEGORIES.MORNING;
  } else if (hour >= 12 && hour < 18) {
    category = MESS_CATEGORIES.AFTERNOON;
  } else {
    category = MESS_CATEGORIES.EVENING;
  }

  const randomIndex = Math.floor(Math.random() * category.messages.length);
  return category.messages[randomIndex];
};
