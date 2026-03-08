/**
 * Deterministic synthetic dataset generator for the Appraisal Lab.
 * Uses a seeded Linear Congruential Generator (LCG) for reproducible output.
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import {
  Emotion, AppraisalRow, AppraisalVector,
  Valence, Arousal, Agency, Control, Certainty, GoalRelevance,
} from '../types';
import { EMOTIONS } from '../schema';

// ============================================================
// Seeded PRNG — Linear Congruential Generator
// ============================================================

/**
 * A deterministic PRNG using the LCG algorithm with Numerical Recipes
 * parameters: a = 1664525, c = 1013904223, m = 2^32.
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Ensure a non-zero unsigned 32-bit seed
    this.state = (seed >>> 0) || 1;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /** Returns an integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Pick a uniformly random element from an array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(arr.length)];
  }

  /** Pick from a weighted distribution. Weights need not sum to 1. */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

// ============================================================
// Appraisal profiles — probability weights per dimension bin
// ============================================================

interface EmotionProfile {
  valence: readonly number[];        // [NEG, NEU, POS]
  arousal: readonly number[];        // [LOW, MED, HIGH]
  agency: readonly number[];         // [SELF, OTHER, SITUATION]
  control: readonly number[];        // [LOW, MED, HIGH]
  certainty: readonly number[];      // [LOW, HIGH]
  goalRelevance: readonly number[];  // [LOW, HIGH]
}

/**
 * Qualitative appraisal profiles for each emotion.
 * These encode the dimensional tendencies described in the spec.
 */
const PROFILES: Record<Emotion, EmotionProfile> = {
  JOY: {
    valence:        [0.05, 0.10, 0.85],
    arousal:        [0.10, 0.40, 0.50],
    agency:         [0.40, 0.35, 0.25],
    control:        [0.05, 0.40, 0.55],
    certainty:      [0.10, 0.90],
    goalRelevance:  [0.10, 0.90],
  },
  ANGER: {
    valence:        [0.85, 0.10, 0.05],
    arousal:        [0.05, 0.25, 0.70],
    agency:         [0.10, 0.60, 0.30],
    control:        [0.10, 0.40, 0.50],
    certainty:      [0.10, 0.90],
    goalRelevance:  [0.15, 0.85],
  },
  FEAR: {
    valence:        [0.80, 0.15, 0.05],
    arousal:        [0.05, 0.15, 0.80],
    agency:         [0.20, 0.30, 0.50],
    control:        [0.70, 0.25, 0.05],
    certainty:      [0.80, 0.20],
    goalRelevance:  [0.20, 0.80],
  },
  SADNESS: {
    valence:        [0.80, 0.15, 0.05],
    arousal:        [0.45, 0.40, 0.15],
    agency:         [0.30, 0.30, 0.40],
    control:        [0.65, 0.25, 0.10],
    certainty:      [0.20, 0.80],
    goalRelevance:  [0.25, 0.75],
  },
  DISGUST: {
    valence:        [0.80, 0.15, 0.05],
    arousal:        [0.15, 0.55, 0.30],
    agency:         [0.05, 0.55, 0.40],
    control:        [0.30, 0.45, 0.25],
    certainty:      [0.30, 0.70],
    goalRelevance:  [0.30, 0.70],
  },
  SURPRISE: {
    valence:        [0.30, 0.35, 0.35],
    arousal:        [0.05, 0.35, 0.60],
    agency:         [0.15, 0.35, 0.50],
    control:        [0.50, 0.35, 0.15],
    certainty:      [0.80, 0.20],
    goalRelevance:  [0.40, 0.60],
  },
};

// ============================================================
// Emotion distribution weights (mild real-world skew)
// ============================================================

const EMOTION_WEIGHTS: readonly number[] = [
  0.19,  // JOY
  0.18,  // ANGER
  0.17,  // FEAR
  0.17,  // SADNESS
  0.15,  // DISGUST
  0.14,  // SURPRISE
];

// ============================================================
// Ambiguity configuration
// ============================================================

/** Emotions eligible for ambiguity and their confusable partners. */
const AMBIGUITY_MAP: Partial<Record<Emotion, readonly Emotion[]>> = {
  ANGER:    ["FEAR", "DISGUST"],
  FEAR:     ["ANGER", "SURPRISE"],
  DISGUST:  ["ANGER"],
  SURPRISE: ["FEAR"],
};

/** Fraction of eligible-emotion rows that become ambiguous (~40% ≈ 25% overall). */
const AMBIGUITY_RATE = 0.40;

/** Blend ratio: 60% primary profile, 40% confusable profile. */
const PRIMARY_BLEND = 0.60;
const SECONDARY_BLEND = 0.40;

// ============================================================
// Text templates per emotion
// ============================================================

const TEXTS: Record<Emotion, readonly string[]> = {
  JOY: [
    "I just got the promotion I have been working toward for months.",
    "My best friend threw me a surprise birthday party and I loved it.",
    "I passed my final exam with flying colors today.",
    "We just closed on our first house and I could not be happier.",
    "I finally finished writing my novel after three years of work.",
    "My daughter took her first steps today and it was incredible.",
    "I reconnected with an old friend I had not seen in years.",
    "The garden I planted this spring is blooming beautifully.",
    "I received a heartfelt thank-you note from a former student.",
    "Our team won the championship game in the final minute.",
    "I found out today that I am going to be a grandparent.",
    "The sunset tonight was absolutely breathtaking.",
    "I got accepted into my dream university program.",
    "My partner planned an amazing anniversary dinner for us.",
    "I finally learned to play that difficult piano piece perfectly.",
    "The community fundraiser exceeded its goal by double.",
    "I woke up feeling genuinely refreshed and grateful this morning.",
    "My project at work just received a national recognition award.",
    "I spent a wonderful weekend camping with my whole family.",
    "The book I recommended to everyone made the bestseller list.",
    "I just adopted a puppy from the local shelter.",
    "My recovery has been going much better than anyone expected.",
    "I made a new friend at the volunteer event last weekend.",
    "Everything just clicked into place for me today.",
    "I got wonderful feedback on my big presentation at work.",
    "My kids made me breakfast in bed this morning as a surprise.",
    "I finished running a marathon for the first time in my life.",
    "The autumn leaves look absolutely gorgeous this year.",
    "I landed my very first freelance client today.",
    "My mentor told me how proud she is of my professional growth.",
  ],
  ANGER: [
    "Someone cut in front of me in line after I waited for an hour.",
    "My coworker took full credit for my entire project.",
    "They changed the rules right in the middle of the process.",
    "My landlord refuses to fix the broken heater yet again.",
    "I was charged twice for the same service and nobody will help me.",
    "Someone scratched my car in the parking lot and drove off.",
    "My neighbor blasts loud music every single night without fail.",
    "They canceled my flight with zero notice or compensation.",
    "I discovered that my personal data was shared without my consent.",
    "The contractor did a terrible job and will not return my calls.",
    "My order arrived completely wrong for the third time in a row.",
    "Someone spread false information about me at my workplace.",
    "The customer service agent actually hung up on me mid-call.",
    "I was passed over for the promotion despite clear qualifications.",
    "They promised delivery by Friday and it still has not shown up.",
    "My roommate keeps eating my food from the fridge without asking.",
    "The insurance company denied my perfectly legitimate claim.",
    "Someone left a dent in my car door and did not leave a note.",
    "My manager publicly criticized me in front of the entire team.",
    "They raised the price immediately after I committed to buying.",
    "My colleague completely dismissed my concerns in the meeting.",
    "The repair shop overcharged me by several hundred dollars.",
    "Someone broke their promise to me once again without apology.",
    "I keep getting spam calls despite being on the do-not-call list.",
    "The HOA fined me for something that is not even in the bylaws.",
    "My sibling borrowed my belongings and never returned them.",
    "They moved my project deadline up without consulting me first.",
    "I was given unclear instructions then blamed for the outcome.",
    "Someone parked in my reserved parking spot again today.",
    "The company policy is completely unfair to its own employees.",
  ],
  FEAR: [
    "I heard a strange noise downstairs in the middle of the night.",
    "My doctor wants to run more tests but would not explain why.",
    "I might lose my job if the company goes through restructuring.",
    "The turbulence on that flight was the worst I have ever felt.",
    "I have to give a speech in front of five hundred people tomorrow.",
    "The storm warning says everyone should take shelter immediately.",
    "I am not sure if I will be able to make rent this month.",
    "My child is late coming home and is not answering the phone.",
    "I noticed someone following me during my walk home tonight.",
    "The medical test results will not be back for another full week.",
    "I cannot remember if I locked the front door before leaving.",
    "The road conditions are becoming dangerous with all this ice.",
    "I have no idea what is going to happen with my pending court case.",
    "My savings are running out much faster than I originally planned.",
    "I think someone may have gained unauthorized access to my bank account.",
    "The building fire alarm went off and nobody seems to know why.",
    "I am genuinely worried about my parent's health getting worse.",
    "I have no idea what to expect on my first day at the new school.",
    "The water level keeps rising dangerously close to our property.",
    "I may have made a serious mistake in the quarterly report.",
    "I am very nervous about driving in this heavy fog tonight.",
    "There is a lot of uncertainty about what happens next for us.",
    "I keep having nightmares about failing the certification exam.",
    "The power went out during the worst part of the thunderstorm.",
    "I do not know if the upcoming surgery will go as planned.",
    "My work contract might not be renewed for next quarter.",
    "I am afraid of what the building inspection might uncover.",
    "The elevator made a grinding noise and stopped between floors.",
    "I feel completely unprepared for the interview tomorrow morning.",
    "Something feels wrong but I cannot put my finger on what it is.",
  ],
  SADNESS: [
    "My grandmother passed away peacefully last night.",
    "I found out my closest friend is moving across the country.",
    "The project I poured my heart into was abruptly canceled.",
    "I have not been able to see my family in well over a year.",
    "My childhood home is scheduled to be torn down next month.",
    "I realized I have slowly drifted apart from most of my old friends.",
    "The scholarship I was counting on did not come through.",
    "My dog has just been diagnosed with a terminal illness.",
    "I missed my daughter's school play because of a work meeting.",
    "The community center where I grew up is closing its doors.",
    "I keep thinking about how things used to be before everything changed.",
    "Nobody remembered my birthday this year and it stung.",
    "I had to say goodbye to a colleague I truly admired and respected.",
    "The old neighborhood looks nothing like it did when I was young.",
    "I lost every single photo when my hard drive failed unexpectedly.",
    "My partner and I decided it was best to go our separate ways.",
    "I could not attend the funeral because of travel restrictions.",
    "The local bookstore where I spent my weekends has closed for good.",
    "I feel like I spent years on something that ultimately did not matter.",
    "My mentor retired last week and I will not see her at work anymore.",
    "I watched the final episode of the show and felt strangely empty.",
    "The holiday season feels especially lonely this year without family.",
    "I found an old letter from someone I have since lost touch with.",
    "My application was turned down for the fifth consecutive time.",
    "I cannot seem to shake this persistent feeling of heaviness.",
    "The tree we planted together years ago did not survive the winter.",
    "I missed the chance to tell them how much they truly meant to me.",
    "Everything around me reminds me of what I no longer have.",
    "I tried my absolute best but it still was not good enough.",
    "The house feels so quiet now that everyone has moved away.",
  ],
  DISGUST: [
    "I found mold growing all over the food left in the fridge.",
    "The restaurant kitchen was filthy when I caught a glimpse inside.",
    "Someone littered right in front of me at the public park.",
    "I read about the corruption scandal involving several local officials.",
    "The product I purchased turned out to be a cheap counterfeit.",
    "I discovered the company has been illegally dumping industrial waste.",
    "The restroom at that rest stop was absolutely revolting.",
    "I found out my coworker has been lying about their credentials.",
    "There was a cockroach sitting in my meal at the restaurant.",
    "The hypocrisy behind that public statement is truly unbelievable.",
    "Someone was being incredibly rude and demeaning to the cashier.",
    "I had to clean up after someone who completely trashed the shared space.",
    "The landlord knowingly rented out a unit infested with pests.",
    "I learned the charity organization was misusing all its donations.",
    "The smell coming from the nearby dumpster was overwhelming today.",
    "Someone plagiarized my original work and published it as their own.",
    "The water coming from the kitchen tap was visibly discolored.",
    "I overheard someone making blatantly dishonest claims to a client.",
    "The sidewalk was covered in garbage after the weekend festival.",
    "I found out that all the online reviews were completely fabricated.",
    "An expired product was still sitting right there on the store shelf.",
    "Someone acted in a truly selfish and inconsiderate manner today.",
    "The conditions those animals were being kept in were appalling.",
    "I cannot believe how poorly the waste disposal was managed.",
    "The deception behind that marketing campaign is genuinely gross.",
    "There was something slimy and unidentifiable on the stairway handrail.",
    "The ethical violations documented in that report are deeply disturbing.",
    "I had to throw away an entire batch of food because it was spoiled.",
    "The gym locker room smelled terrible and clearly nobody had cleaned it.",
    "I watched someone cheat blatantly without facing any consequences.",
  ],
  SURPRISE: [
    "I ran into my college roommate at an airport on the other side of the world.",
    "My test results came back completely different from what I had expected.",
    "A package I forgot I ordered suddenly arrived out of nowhere.",
    "I discovered a hidden room behind the bookshelf in my new house.",
    "My quiet neighbor turned out to be a well-known professional musician.",
    "The final score was the complete opposite of every prediction made.",
    "I found a rare first-edition book at a neighborhood garage sale.",
    "My phone rang and it was someone I had not spoken to in over a decade.",
    "The election results caught absolutely everyone off guard.",
    "I opened my email and found a completely unexpected job offer waiting.",
    "The plot twist at the very end of the movie completely stunned me.",
    "I showed up to the meeting only to find it had been rescheduled.",
    "My routine blood work came back with a finding nobody anticipated.",
    "The street I drive on every day was completely transformed overnight.",
    "I received a refund I never even applied for in the first place.",
    "The weather shifted from bright sunshine to hail within just minutes.",
    "I accidentally discovered a shortcut I never knew existed before.",
    "The restaurant bill was less than half of what I had expected to pay.",
    "A student nobody expected to win ended up taking first place overall.",
    "I opened the front door and everyone shouted for me to come look.",
    "The announcement this morning changed everything we had planned for.",
    "I did not even recognize the person standing right in front of me.",
    "The experimental results completely contradicted our initial hypothesis.",
    "I received a letter from someone I was sure had moved away for good.",
    "The meeting took a completely different direction than anyone planned.",
    "My old car started right up after sitting unused for two full years.",
    "I solved the problem entirely by accident while working on something else.",
    "The price dropped significantly just minutes after I last checked.",
    "I walked into the wrong conference room and found a different event.",
    "The news about the corporate merger came as a total shock to everyone.",
  ],
};

// ============================================================
// Dimension bin arrays (for weighted-pick indexing)
// ============================================================

const VALENCE_OPTIONS: readonly Valence[] = ["NEG", "NEU", "POS"];
const AROUSAL_OPTIONS: readonly Arousal[] = ["LOW", "MED", "HIGH"];
const AGENCY_OPTIONS: readonly Agency[] = ["SELF", "OTHER", "SITUATION"];
const CONTROL_OPTIONS: readonly Control[] = ["LOW", "MED", "HIGH"];
const CERTAINTY_OPTIONS: readonly Certainty[] = ["LOW", "HIGH"];
const GOAL_RELEVANCE_OPTIONS: readonly GoalRelevance[] = ["LOW", "HIGH"];

// ============================================================
// Profile blending for ambiguous cases
// ============================================================

function blendWeights(
  primary: readonly number[],
  secondary: readonly number[],
): number[] {
  return primary.map((p, i) => PRIMARY_BLEND * p + SECONDARY_BLEND * secondary[i]);
}

function blendProfiles(a: EmotionProfile, b: EmotionProfile): EmotionProfile {
  return {
    valence:       blendWeights(a.valence, b.valence),
    arousal:       blendWeights(a.arousal, b.arousal),
    agency:        blendWeights(a.agency, b.agency),
    control:       blendWeights(a.control, b.control),
    certainty:     blendWeights(a.certainty, b.certainty),
    goalRelevance: blendWeights(a.goalRelevance, b.goalRelevance),
  };
}

// ============================================================
// Appraisal vector generation
// ============================================================

function generateAppraisals(rng: SeededRNG, profile: EmotionProfile): AppraisalVector {
  return {
    valence:       rng.weightedPick(VALENCE_OPTIONS, profile.valence),
    arousal:       rng.weightedPick(AROUSAL_OPTIONS, profile.arousal),
    agency:        rng.weightedPick(AGENCY_OPTIONS, profile.agency),
    control:       rng.weightedPick(CONTROL_OPTIONS, profile.control),
    certainty:     rng.weightedPick(CERTAINTY_OPTIONS, profile.certainty),
    goalRelevance: rng.weightedPick(GOAL_RELEVANCE_OPTIONS, profile.goalRelevance),
  };
}

// ============================================================
// Public API
// ============================================================

/**
 * Generate a deterministic synthetic dataset.
 *
 * @param seed  - Integer seed for the PRNG (same seed → identical output).
 * @param n     - Number of rows to generate (default 900).
 * @returns Array of AppraisalRow objects.
 */
export function generateDataset(seed: number, n: number = 900): AppraisalRow[] {
  const rng = new SeededRNG(seed);
  const rows: AppraisalRow[] = [];

  for (let i = 0; i < n; i++) {
    // 1. Pick emotion from mildly skewed distribution
    const emotion: Emotion = rng.weightedPick(EMOTIONS, EMOTION_WEIGHTS);

    // 2. Determine if this row is ambiguous
    const confusablePartners = AMBIGUITY_MAP[emotion];
    const isAmbiguous =
      confusablePartners !== undefined &&
      confusablePartners.length > 0 &&
      rng.next() < AMBIGUITY_RATE;

    // 3. Build the profile (blended for ambiguous rows)
    let profile = PROFILES[emotion];
    if (isAmbiguous && confusablePartners) {
      const partner = rng.pick(confusablePartners);
      profile = blendProfiles(PROFILES[emotion], PROFILES[partner]);
    }

    // 4. Generate appraisals from the profile
    const appraisals = generateAppraisals(rng, profile);

    // 5. Pick a text template (text always matches the gold-label emotion)
    const texts = TEXTS[emotion];
    const text = texts[rng.nextInt(texts.length)];

    // 6. Build the row
    const id = `APR-${String(i + 1).padStart(4, "0")}`;
    rows.push({ id, text, emotion, appraisals });
  }

  return rows;
}
