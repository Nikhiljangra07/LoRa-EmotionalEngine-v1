/**
 * CLI: Generate synthetic DISGUST and NEUTRAL dataset entries.
 *
 * Produces exactly 2400 entries (1200 per emotion) in ISEAR
 * first-person autobiographical narrative style using deterministic
 * seeded PRNG and compositional templates.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/cli/generate_synthetic.ts [seed]
 *
 * Output:
 *   src/appraisal-lab/dataset/synthetic_disgust_neutral.json
 *
 * This module is fully isolated — no imports from outside src/appraisal-lab/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SeededRNG } from '../dataset/generator';

// ============================================================
// Template expansion engine
// ============================================================

/**
 * Expand inline choice points in a template string.
 * Syntax: "I {opened|found|discovered} the {box|bag}."
 * Each {a|b|c} is replaced with a randomly chosen option.
 */
function expand(rng: SeededRNG, template: string): string {
  return template.replace(/\{([^}]+)\}/g, (_, choices: string) => {
    const opts = choices.split('|');
    return opts[rng.nextInt(opts.length)];
  });
}

// ============================================================
// Output types
// ============================================================

interface SyntheticEntry {
  id: string;
  sentiment: string;
  content: string;
}

interface Theme {
  openers: string[];
  continuations: string[];
}

// ============================================================
// Label leakage ban lists
// ============================================================

const DISGUST_BANNED = [
  "disgust", "disgusted", "disgusting", "grossed", "repulsed", "repulsive",
  "revolting", "revolted", "sickening", "sickened", "nauseating", "nauseated",
  "loathsome", "abhorrent", "vile", "repugnant",
];

const NEUTRAL_BANNED = [
  "neutral", "calm", "calming", "indifferent", "apathetic", "unbothered",
  "unmoved", "meh",
];

function hasLeakage(text: string, banned: string[]): boolean {
  const lower = text.toLowerCase();
  for (const word of banned) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(lower)) return true;
  }
  return false;
}

// ============================================================
// DISGUST TEMPLATES
// ============================================================

// --- Theme 1: Food contamination ---

const D_FOOD_O: string[] = [
  "I {opened|pulled out|checked on|took out} {a container|the tupperware|a sealed bag|a jar|a package} that had been {sitting|left|stored|forgotten} in the {refrigerator|office fridge|back of the pantry|kitchen cabinet} for {several weeks|what must have been weeks|longer than intended|an unknown amount of time}.",
  "The {leftovers|produce|food items|prepared meal|ingredients} in the {fridge|communal kitchen|storage area|break room refrigerator} had {turned a greenish color|developed visible mold|begun to break down|changed in both color and texture|started to emit a strong odor}.",
  "While {cleaning out the kitchen|reorganizing the pantry|going through the refrigerator|clearing the break room}, I {found|came across|noticed|discovered} {spoiled produce|expired dairy products|rotten fruit|forgotten meat|old takeout} that had been {overlooked|pushed behind other items|left for too long}.",
  "Someone had left {a plate of food|an open container|unwrapped leftovers|a half-finished meal|uncovered scraps} on the {counter|break room table|shared desk|kitchen surface} for {the entire weekend|at least two days|what appeared to be several days|longer than was reasonable}.",
  "I {opened|lifted the lid of|peered into|looked inside} the {waste bin|garbage can|compost container|dumpster near the building} and the {state of the contents|volume of decaying material|condition of the interior|accumulation inside} was {more than I expected|immediately noticeable|beyond what I had anticipated}.",
  "The {fruit|bread|cheese|meat|fish} that had been {left out on the counter|forgotten in the pantry|stored improperly|left in a bag by the door} had {attracted small insects|developed a fuzzy coating|begun to liquefy|become soft and discolored|changed into something unrecognizable}.",
  "When I {returned from vacation|came back from a week away|arrived home after traveling}, the {food I had forgotten about|groceries I left on the counter|produce I neglected to refrigerate} had {completely deteriorated|broken down in the heat|become a breeding ground for small flies}.",
  "I {bit into|took a sip of|tasted|tried} the {sandwich|milk|soup|juice|yogurt} and {realized it had turned|could tell from the texture it was spoiled|detected a sour taste that indicated it had gone bad|noticed the consistency was wrong}.",
  "At the {restaurant|cafeteria|food stall|catering event|outdoor market}, I {noticed|saw|observed|caught a glimpse of} the {food preparation area|kitchen|serving station|cooking surface} in a {poor state of cleanliness|condition that did not inspire confidence|state of visible neglect|way that raised concerns about sanitation}.",
  "The {communal refrigerator|shared kitchen|dormitory break room|office pantry} had {not been cleaned in a long time|developed a persistent smell|items that had clearly been abandoned for weeks|stains and residue covering multiple shelves}.",
  "I was {putting away groceries|organizing the freezer|unpacking a delivery|restocking the kitchen} when I {noticed|discovered|came across|found} a {container|bag|package|box} at the {back|bottom|far corner|rear} of the {shelf|drawer|cabinet} with contents that had {changed color|leaked|swelled|separated into layers|developed an unusual film}.",
  "The {lunch I had packed|meal that was brought to the office|food that had been left out for the event|catered platter on the table} had been {sitting at room temperature|exposed to warm conditions|left uncovered|unrefrigerated} for {several hours|the better part of the day|far too long for it to still be suitable}.",
];

const D_FOOD_C: string[] = [
  "The {smell|odor} had {spread throughout|permeated|lingered in|filled|drifted through} the {surrounding area|kitchen|entire room|workspace|hallway}.",
  "I had to {dispose of|throw away|remove} everything that had been {near it|stored beside it|on the same shelf|in contact with the residue}.",
  "{Small insects|Fruit flies|Tiny gnats} had already {gathered|appeared|begun to collect|formed a cluster} {around it|on its surface|in the immediate area}.",
  "The {surface beneath it|shelf it sat on|area around it|counter underneath} was {coated in|covered with|stained by} a {dark|sticky|cloudy|thick} {residue|substance|film|liquid}.",
  "It {took considerable effort|required multiple rounds of cleaning|took much longer than expected} to {restore the area|remove the buildup|eliminate the lingering odor|make the space usable again}.",
  "No one in the {office|household|building|shared space} {claimed responsibility|admitted to leaving it|acknowledged it was theirs|would take ownership of the situation}.",
  "I had to {open the windows|step outside for air|leave the area temporarily|ventilate the room} because the {air|atmosphere|conditions} had become {very difficult to tolerate|too strong to remain near|more than I could handle at that moment}.",
  "Several {colleagues|roommates|family members|other residents} had {also noticed the problem|mentioned the same issue|brought it up independently} but no one had {dealt with it|taken action|addressed the situation}.",
  "The {entire shelf|surrounding containers|adjacent items|nearby food} had to be {inspected|checked|cleaned|removed} as a {precaution|result|consequence}.",
  "When I {returned the next day|came back later|checked again the following morning}, the {situation|condition|problem} had {not improved|continued to develop|worsened in the interim}.",
];

// --- Theme 2: Hygiene and sanitation ---

const D_HYG_O: string[] = [
  "The public {restroom|washroom|bathroom|facilities} at the {station|rest stop|park|shopping center|gas station} had {clearly not been cleaned in some time|paper towels scattered across the wet floor|a strong smell upon entry|water pooling near the sinks}.",
  "I {observed|noticed|saw|watched} the person {handling my food|preparing the order|working at the counter|serving the meal} {skip hand washing|wipe their hands on their clothing|touch their face before handling ingredients|neglect basic preparation steps} before {continuing their work|returning to the food|picking up the utensils}.",
  "The {hotel room|rental apartment|guest house|hostel room} I {checked into|arrived at|was assigned} had {stains on the bedding|hair on the bathroom floor|a musty smell throughout|visible grime on the fixtures|dust accumulated in every corner}.",
  "The {gym|fitness center|swimming pool|changing room} {locker area|shower area|floor|equipment} was {covered in moisture and residue|visibly unclean|in a state I had not expected|showing signs of prolonged neglect}.",
  "When I {sat down at|was shown to|arrived at} the {restaurant table|diner booth|cafe table|seating area}, the {surface|table|menu|utensils} {were sticky to the touch|had visible marks from a previous patron|had not been properly wiped down|still had crumbs and spills from earlier}.",
  "I {received|was given|picked up|was handed} a {plate|cup|glass|utensil|tray} at the {cafeteria|buffet|food court|canteen} that {had dried food stuck to it|was not properly clean|had a noticeable smudge|showed residue from its previous use}.",
  "The {sink|drain|pipes|faucet} in the {kitchen|bathroom|laundry room|basement} had {backed up with standing water|a dark buildup around the edges|begun to emit an unpleasant smell|residue coating the interior}.",
  "While {visiting|staying at|passing through} the {facility|building|campus|venue}, I {noticed|observed|was struck by} the {condition of the restrooms|state of the shared spaces|lack of basic maintenance|level of upkeep in common areas}.",
  "The {bus seat|train car|taxi interior|ride-share vehicle|airplane tray table} I {sat in|used|was riding in} had {stains of unknown origin|a sticky surface|debris wedged into the seams|marks that suggested it had not been cleaned between passengers}.",
  "The {waiting room|reception area|clinic|common area} had {a carpet that was visibly stained|chairs with worn and soiled upholstery|surfaces that had not been wiped recently|a general air of neglect about it}.",
  "The {public drinking fountain|water dispenser|communal kitchen tap|shared coffee machine} at the {office|park|gym|school} had {a layer of buildup around the spout|discolored residue near the basin|not been descaled or maintained|a visible film near where the water came out}.",
];

const D_HYG_C: string[] = [
  "There was {no soap|no paper towels|no hand sanitizer|nothing available for basic hygiene} in the {dispenser|holder|container}, and it appeared to have been {empty for some time|neglected for days|ignored by staff}.",
  "The {floor|surface|walls} {near the entrance|around the fixtures|in the corners|beneath the counters} had a {buildup|layer|coating} of {grime|residue|material} that suggested {prolonged neglect|a lack of regular cleaning|it had not been attended to in a long while}.",
  "I {chose not to use the facilities|decided to find an alternative|left without finishing|relocated to a different area}.",
  "Other {patrons|visitors|guests|customers} {seemed to notice as well|were visibly uncomfortable|made similar observations|shifted away from the area}.",
  "Despite {signage claiming regular maintenance|a posted cleaning schedule|assurances from staff}, the {actual conditions|reality|state of things} told {a different story|quite a different tale}.",
  "I {mentioned it to|spoke to|notified} {the management|a staff member|someone in charge|the front desk} about the {condition|state|situation}, but {received no clear response|was told they would look into it|nothing appeared to change}.",
  "It was {apparent|clear|evident} that {regular cleaning|basic maintenance|routine sanitation practices} had {not been a priority|fallen behind|been neglected for some time}.",
  "I {made a note|reminded myself|decided} to {avoid the location|find alternatives|not return|check conditions in advance} in the future.",
  "The {experience|observation|encounter} made me {more attentive to such conditions|more cautious about where I eat|more aware of standards I had previously taken for granted}.",
];

// --- Theme 3: Environmental pollution and neglect ---

const D_ENV_O: string[] = [
  "The {river|stream|pond|canal|waterway} near the {industrial area|factory|development site|residential zone} had a {thick oily film|layer of foam|discolored surface|murky quality|visible accumulation of debris} on the water.",
  "Walking through the {park|neighborhood|town center|public space|plaza} after the {festival|weekend|holiday|event}, I {saw|noticed|found|observed} {trash scattered everywhere|litter covering the pathways|refuse piled beside overflowing bins|waste strewn across the grass}.",
  "The {alley|passage|corridor|walkway|stairwell} behind the {building|restaurant|shops|apartments} was {littered with debris|in a state of severe neglect|filled with discarded waste|overflowing with refuse}.",
  "The {vacant lot|abandoned property|disused site|empty building} next to {my home|the school|the main road|the park} had {accumulated piles of waste|become a dumping site|attracted vermin|developed visible pest activity}.",
  "The {beach|lakeside|shoreline|riverbank|coastal path} was {covered in washed-up waste|dotted with plastic debris|lined with discarded items|strewn with refuse that had accumulated over time}.",
  "I {walked|drove|cycled|passed} by the {waste processing facility|landfill boundary|sewage treatment area|industrial discharge zone} and the {air quality|atmosphere|surrounding environment|conditions} {were noticeably affected|had clearly been impacted|showed signs of contamination}.",
  "The {construction site|building project|development area|demolition site} had left {piles of materials|debris|standing water|uncovered waste} that had been {sitting untouched for months|accumulating without any cleanup|left exposed to the elements}.",
  "After the {heavy rain|flooding|storm|seasonal runoff}, the {streets|gutters|drains|low-lying areas} were {filled with|carrying|covered in} {runoff|debris|sediment|material} that had been {washed from nearby sites|carried from the surrounding area|displaced from overloaded systems}.",
  "The {air near the plant|atmosphere downwind of the facility|environment by the factory|conditions around the industrial complex} carried {a persistent chemical odor|a heavy industrial smell|particles that were visible in the light|a quality that made prolonged exposure uncomfortable}.",
  "I {noticed|observed|saw} that the {drainage ditch|gutter|storm drain|outlet pipe} was {discharging a discolored liquid|releasing a cloudy substance|producing foam|emitting visible effluent|carrying material that did not look like normal water}.",
  "The {neighborhood park|community garden|public green space|recreation area} had {litter embedded in the soil|broken glass near the play equipment|debris collecting along the fence|evidence of improper waste disposal throughout}.",
];

const D_ENV_C: string[] = [
  "The {wildlife|birds|fish|local animals|vegetation} in the {area|vicinity|surrounding habitat} had {been visibly affected|thinned noticeably|shown signs of decline|all but disappeared from that section}.",
  "{Local residents|Neighbors|People living nearby|Families in the area} had {raised concerns|filed complaints|spoken up|submitted reports} {multiple times|repeatedly|for months}, {with no visible result|but conditions had not changed|yet the situation persisted}.",
  "The {smell|conditions|state of the surroundings} was {noticeable from a considerable distance|present even with windows closed|something that had become part of daily life for residents}.",
  "Despite {posted regulations|environmental standards|public promises of remediation|government oversight}, the {situation|conditions|problem} had {only worsened|remained the same|shown no sign of change} over the past {months|year|several years}.",
  "What had once been a {well-maintained area|usable public resource|thriving natural environment|place where people gathered} had {deteriorated beyond recognition|become something very different|been allowed to fall into severe disrepair}.",
  "{Children|Pedestrians|Workers|Visitors} who {used|passed through|frequented|lived near} the area were {exposed to these conditions daily|unable to avoid the situation|directly affected by the ongoing problem}.",
  "The {issue|problem|situation} appeared to be {longstanding|not recent|the result of years of neglect|something that had developed gradually}.",
  "I {documented what I saw|made note of the conditions|took photographs of the area} in case {they were needed later|it became necessary to report the situation|the issue escalated further}.",
  "There {was no indication|were no signs|appeared to be no effort} that {cleanup was planned|anyone had been assigned to address it|remediation was underway|the responsible parties intended to act}.",
];

// --- Theme 4: Moral and ethical violations ---

const D_MORAL_O: string[] = [
  "I {learned|found out|discovered|was told} that {a supervisor|the manager|a senior colleague|someone in a trusted position} had been {taking credit for subordinates' work|falsifying records|misrepresenting outcomes|manipulating reports|concealing critical information} for {over a year|an extended period|longer than anyone had realized}.",
  "It {came to light|was revealed|became known|surfaced} that the {charitable organization|nonprofit|foundation|community fund} had been {redirecting donations|misallocating funds|diverting resources} for {personal expenses|unauthorized purposes|private benefit|uses unrelated to its stated mission}.",
  "I {read|heard about|learned of|came across a report about} a case where {elderly patients|children in care|workers without legal protections|people who could not advocate for themselves} had been {taken advantage of|subjected to neglect|overcharged for basic services|left without the care they were promised} by {those responsible for their welfare|the system meant to serve them}.",
  "The {company|firm|institution|organization} had been {knowingly selling|distributing|providing|continuing to offer} {defective products|substandard materials|services they knew were inadequate|items that did not meet safety requirements} while {charging full price|certifying compliance|assuring clients of quality}.",
  "Someone I {had trusted|respected|considered reliable|had known for a long time} had been {lying to me|misrepresenting the facts|providing false information|deliberately misleading people} about {something significant|a matter of real consequence|the actual state of affairs}.",
  "The {investigation|audit|review|inquiry} revealed that {safety reports|financial records|inspection results|compliance documents} had been {fabricated|falsified|altered|selectively edited} to {conceal violations|hide deficiencies|present a misleading picture|avoid accountability}.",
  "I {witnessed|observed|was present when} someone in {a position of authority|leadership|trust|responsibility} {used their influence|leveraged their position|exploited their role} to {benefit themselves at others' expense|secure an unfair advantage|silence someone who raised concerns|avoid consequences}.",
  "The {landlord|property owner|building manager|contractor} had {concealed|failed to disclose|deliberately not mentioned|hidden} {serious structural issues|known health hazards|code violations|pre-existing damage} before {renting the property|completing the transaction|signing the agreement}.",
  "I {discovered|found out|became aware} that {someone in the group|a colleague|a trusted associate} had been {spreading false information|telling different stories to different people|manipulating situations behind the scenes|working against the interests of those who trusted them}.",
  "An {employee|worker|individual|staff member} who {reported safety concerns|raised legitimate complaints|flagged unethical practices|identified procedural problems} was {demoted|reassigned|let go|isolated} shortly after {speaking up|filing the report|making the information known}.",
  "The {contract|agreement|arrangement|deal} had {hidden clauses|undisclosed conditions|terms that contradicted verbal assurances|provisions designed to benefit only one party} that only became {apparent|known|visible} {after signing|once the commitment was made|when it was too late to renegotiate}.",
];

const D_MORAL_C: string[] = [
  "Those who {raised concerns|tried to intervene|spoke up|questioned the situation} were {ignored|marginalized|discouraged from pursuing it|told the matter was being handled|met with resistance}.",
  "The {affected individuals|people impacted|those who suffered as a result} had {little recourse|few options|no clear path to resolution|limited ability to seek accountability}.",
  "It {appeared|was apparent|became clear|was evident} that {multiple people|several individuals|others in the organization} had {known about the situation|been aware|turned a blind eye|chosen not to act} for {a considerable time|months|years}.",
  "The {public|affected community|employees|stakeholders} were {not informed|kept in the dark|given misleading assurances|told a different version of events|only made aware after the damage was done}.",
  "When the {facts|full scope|truth} finally {emerged|came out|became public|were disclosed}, the {official response|organizational reaction|statement} was {inadequate|focused on damage control rather than accountability|dismissive of those affected}.",
  "The {pattern|behavior|practice} had been {sustained|operating|in place|continuing} for {so long|such a period} that it had become {normalized within the system|embedded in the culture|something people simply accepted}.",
  "I {kept thinking about|could not stop reflecting on|found myself returning to} how many people {might have been affected|had been impacted without knowing|were still unaware of the situation}.",
  "There was {a troubling gap|a clear contradiction|an obvious inconsistency} between {what had been publicly stated|the official position} and {what had actually occurred|what the evidence showed|what those involved experienced}.",
];

// --- Theme 5: Social cruelty and exploitation ---

const D_SOC_O: string[] = [
  "I {watched|observed|witnessed|saw} as a group of {students|coworkers|adults|individuals} {deliberately excluded|openly mocked|talked over|spoke about|ignored} {a new member|someone who had just arrived|a person sitting alone|someone who was visibly uncomfortable} during {a meeting|a lunch break|a social gathering|a group activity}.",
  "The {manager|team lead|instructor|supervisor} {spoke to|addressed|treated} the {cleaning staff|junior employees|service workers|new hire} in a {demeaning|condescending|dismissive|belittling} manner {in front of others|publicly|without any awareness of those watching}.",
  "I {overheard|heard|became aware of} {a conversation|remarks|comments} in which {someone's personal struggles|a colleague's difficulties|a private situation|a sensitive matter} were being {discussed as entertainment|mocked openly|treated as a joke|shared without permission}.",
  "A {colleague|classmate|acquaintance|member of the group} had been {systematically taking credit|positioning themselves advantageously|undermining others|manipulating perceptions} while {presenting a different face publicly|maintaining an appearance of helpfulness|claiming to support those they were working against}.",
  "During the {event|gathering|meeting|dinner}, I {noticed|observed|was struck by} how {certain people|some individuals} were treated {very differently|with noticeably more deference} than {others|those perceived as less important|people from different backgrounds}.",
  "The way the {customer|patient|client|applicant} was {spoken to|treated|responded to|dealt with} at the {office|counter|reception|service desk} was {dismissive|lacking basic courtesy|devoid of professionalism|something that left an impression on everyone present}.",
  "I {discovered|learned|was told|realized} that {someone I knew|a person in our circle|an acquaintance} had been {spreading rumors|sharing private information|making claims|circulating false narratives} about {others behind their backs|people who considered them a friend|individuals not present to defend themselves}.",
  "At the {meeting|community forum|school event|workplace gathering}, one person {repeatedly interrupted|talked over|dismissed the contributions of|refused to acknowledge} {everyone else|those who disagreed|anyone with a different perspective|the people with the least authority in the room}.",
  "The {online discussion|group chat|community thread|forum post} had devolved into people {targeting a specific individual|piling on someone who expressed a different view|sharing someone's personal information without consent|making coordinated efforts to humiliate a person}.",
  "I {saw|watched|observed} an {adult|older person|authority figure|bystander} {stand by and do nothing|look away|walk past|choose not to intervene} while {a child was being mistreated|someone was clearly in distress|a person was being verbally attacked|an individual was being harassed} in {a public space|the street|a store|plain view}.",
  "The {new employee|transfer student|recent arrival|person who had just joined} was being {given deliberately wrong information|set up to fail|excluded from necessary communications|left out of essential training} by {people who had been there longer|established members of the group|those who saw them as a threat}.",
];

const D_SOC_C: string[] = [
  "The person {on the receiving end|being targeted|who was affected} {said nothing|kept their composure|simply looked down|did not respond|withdrew quietly} while the {situation continued|behavior went on|incident unfolded}.",
  "No one {in the group|present|nearby|who witnessed it} {intervened|said anything|stepped in|challenged the behavior|made any attempt to address what was happening}.",
  "It was {not an isolated incident|something that had been happening regularly|reportedly a pattern|part of a longer history|consistent with what others had described}.",
  "The {power dynamic|imbalance|hierarchy|social structure} made it {very difficult|nearly impossible|risky|unlikely} for the {person affected|individual|target} to {respond|push back|confront the behavior|raise the issue}.",
  "I {later learned|found out afterward|was told subsequently} that {similar incidents|this kind of behavior|the same pattern} had been {reported before|happening for a long time|brought up multiple times|occurring regularly}.",
  "What {struck|stayed with|unsettled} me {most|afterward|about the situation} was the {casualness|indifference|normalization|acceptance} with which {everyone|those present|bystanders} {treated the incident|carried on|behaved as if nothing had happened}.",
  "The {person responsible|individual involved} showed {no awareness|no sign of concern|no indication they understood the impact|a complete lack of self-reflection} regarding {their actions|what they had done|how their behavior had affected others}.",
  "I {thought about it for days|could not put it out of my mind|kept returning to it|found myself reflecting on it} and what it {said about the group|revealed about the dynamics at play|indicated about the environment|meant for those who had to navigate it daily}.",
];

// --- Theme 6: Institutional negligence and systemic failures ---

const D_INST_O: string[] = [
  "The {report|investigation|audit findings|review} revealed that the {company|hospital|school|agency|facility} had been {falsifying safety inspection records|covering up violations|ignoring regulatory requirements|operating without proper certifications} for {three consecutive years|an extended period|longer than anyone had suspected}.",
  "I {read|learned|came across a report} that the {hospital|clinic|care facility|medical center} had been {reusing equipment meant for single use|failing to sterilize instruments properly|neglecting basic sanitation protocols|operating with expired supplies|understaffing critical departments}.",
  "The {housing authority|building management|property company|development corporation} had {ignored|dismissed|delayed acting on|downplayed} reports of {lead contamination|structural damage|pest infestations|water quality issues|hazardous conditions} in {units occupied by families|properties they managed|buildings with vulnerable residents}.",
  "Internal {documents|emails|memos|communications} showed that {senior leadership|executives|decision-makers} had been {aware of the risks|informed of the problem|briefed on the failures|presented with evidence} and had {chosen to do nothing|decided the cost of correction was too high|suppressed the information|actively prevented disclosure}.",
  "The {school|university|institution|training program} had {continued to employ|retained|shielded|failed to remove} {an individual|a staff member|someone in a leadership role} despite {documented complaints|multiple formal reports|a pattern of behavior spanning years|warnings from colleagues}.",
  "The {factory|plant|production facility|warehouse} was operating {without proper ventilation|with disabled safety systems|under conditions that violated labor regulations|with equipment that had not passed inspection}, and {oversight had been minimal|no regulatory body had intervened|inspections had been waived}.",
  "After the {incident|accident|outbreak|crisis}, it became {apparent|known|evident} that {warning signs|prior incidents|risk assessments|preliminary reports} had been {systematically ignored|filed away without action|overridden by management|treated as low priority}.",
  "The {pharmaceutical company|food manufacturer|chemical producer|tech company} had {suppressed research findings|withheld data|selectively published results|failed to report adverse outcomes} that {contradicted their marketing|raised serious safety questions|would have affected regulatory approval|indicated potential harm}.",
  "Families {affected by|living near|exposed to} the {contaminated site|polluted area|failed infrastructure|unsafe facility} had been {filing complaints for years|seeking answers|trying to get attention from authorities|reporting health concerns} without {meaningful response|any action being taken|acknowledgment of the problem}.",
  "The {financial institution|bank|lending company|credit agency} had been {targeting vulnerable populations|using predatory practices|applying discriminatory criteria|charging hidden fees|engaging in deceptive lending} while {publicly promoting community commitment|marketing itself as customer-first|receiving public trust awards}.",
  "The {care home|residential facility|housing block|public building} had failed its {annual inspection|safety review|compliance audit|regulatory check} on {multiple occasions|three consecutive reviews|the most recent assessment|every inspection for the past two years}, and yet {it remained open|no action was taken|operations continued as before|residents were not informed}.",
];

const D_INST_C: string[] = [
  "The {full extent|true scale|actual scope|real magnitude} of the {problem|damage|impact|harm} was {only beginning to emerge|still not fully understood|larger than initial reports suggested}.",
  "Those who {bore the consequences|suffered the impact|were affected|had been harmed} were {given little support|offered inadequate compensation|left to manage on their own|not included in the decisions that followed}.",
  "{Oversight|Regulation|Accountability|Enforcement} had {failed at multiple levels|been insufficient|not kept pace with the scale of the operation|been undermined by those with influence}.",
  "The {institution|organization|entity} {issued a statement|released a response} that {acknowledged no wrongdoing|deflected responsibility|focused on future commitments|avoided addressing the specific findings}.",
  "It was {difficult to reconcile|troubling to compare} the {public image|official narrative|stated values} of the {organization|institution|company} with the {documented facts|actual conditions|experiences of those affected}.",
  "The {timeline|chain of decisions|documentary record} made it clear that {this was not an accident|prevention had been possible|the outcome was foreseeable|there had been opportunities to act differently}.",
  "{Reform|Corrective action|Accountability|Meaningful response} had been {promised repeatedly|discussed extensively|publicly pledged} but {implementation remained elusive|the same patterns continued|results had not materialized}.",
  "The {case|revelation|episode} {raised questions|highlighted issues|drew attention to failings} about {the adequacy of current safeguards|whether existing systems were fit for purpose|the gap between policy and practice}.",
];

// ============================================================
// NEUTRAL TEMPLATES
// ============================================================

// --- Theme 1: Morning and daily routines ---

const N_ROUT_O: string[] = [
  "I {woke up|got up|rose} at {six-thirty|seven|my usual time|quarter to seven|half past six} and {followed my regular morning routine|went through my usual steps|got ready as I do most days|began preparing for the day}.",
  "I {made|prepared|had} {coffee|tea|breakfast|a bowl of cereal|toast} and {sat down|took a seat} at the {kitchen table|counter|desk|dining table} before {heading out|leaving for the day|starting work|beginning my commute}.",
  "After {work|my shift|finishing for the day|the afternoon}, I {went home|returned to the apartment|came back|headed home} and {started on dinner|did some laundry|tidied up the kitchen|sorted through the mail|changed clothes}.",
  "I {spent|used|dedicated} the {evening|afternoon|morning|hour after lunch} {reading|organizing my desk|doing household tasks|going through emails|catching up on correspondence}.",
  "The {morning|day|afternoon|evening} {proceeded|went|passed} {without any notable events|as expected|in a fairly standard way|along the lines of a typical weekday}.",
  "I {packed|prepared|made} {lunch|a bag|my things} {the night before|that morning|before leaving|ahead of time} and {set|placed|left} everything {by the door|on the counter|in my bag|where I would remember it}.",
  "My {morning|evening|daily|weekend} routine {included|consisted of|involved} {a short walk|checking the news|reviewing my schedule|watering the plants}, followed by {getting ready for the day|settling in for the evening|moving on to the next task}.",
  "I {finished|completed|wrapped up} the {household chores|cleaning|laundry|dishes|weekly tidying} and then {sat down for a moment|moved on to another task|checked the time|began preparing for the next day}.",
  "I {picked up|collected|grabbed|stopped for} {groceries|a few items|supplies|some essentials} on {my way home|the way back from work|my usual route|the walk back}.",
  "{Before bed|At the end of the day|After dinner|Later in the evening}, I {set the alarm|laid out clothes for the next day|reviewed my schedule for tomorrow|locked up the house|checked that the windows were closed}.",
  "I {ate lunch|had my midday meal|took a break to eat} at {my desk|the usual time|the cafeteria|around noon|twelve-thirty} and {returned to work|resumed my tasks|continued with the afternoon|got back to what I was doing} afterward.",
  "The {laundry|dishes|vacuuming|ironing|weekly cleaning} was {done|completed|finished|taken care of} in the {morning|afternoon|evening|early part of the day}, as it {usually is|typically is|tends to be} on {that day of the week|weekends|my day off}.",
];

const N_ROUT_C: string[] = [
  "The rest of the {day|evening|morning|afternoon} {followed a similar pattern|continued without interruption|went by steadily|proceeded as planned}.",
  "It was a {routine|standard|typical|unremarkable|ordinary} {day|morning|evening|afternoon} by {most measures|all appearances|any account}.",
  "I had {nothing else|no other tasks|no additional plans|nothing further} {scheduled|planned|on the agenda} for the {rest of the day|remainder of the evening|afternoon}.",
  "Everything {was in order|was as expected|went according to plan|was straightforward}.",
  "I {made a mental note|reminded myself|noted} {a few things|the tasks|what needed doing} for {the next day|tomorrow|the following morning}.",
  "There was {nothing unusual|nothing out of the ordinary|nothing unexpected|no notable change} about the {day|schedule|surroundings|evening}.",
  "I {had some time|found a moment|used the gap} between {tasks|activities|commitments} to {organize a few things|tidy up|take care of small details}.",
  "The {sequence of activities|order of tasks|daily pattern|general flow of the day} was {consistent with|the same as|no different from|in line with} most other {days|weeks|mornings|evenings} of the same kind.",
];

// --- Theme 2: Weather and outdoor conditions ---

const N_WEATH_O: string[] = [
  "The {temperature|weather} today was {around twelve degrees|in the mid-twenties|fairly mild for the season|slightly cooler than yesterday|about average for this time of year}, with {light cloud cover|clear skies|partial cloud|overcast conditions|a gentle breeze} {throughout the afternoon|for most of the day|during the morning}.",
  "It {rained|drizzled|showered} for about {twenty minutes|half an hour|most of the morning|an hour or so} in the {early morning|late afternoon|evening|middle of the day}, and {the streets were still damp|puddles had formed along the curb|the air felt cooler afterward|the ground was wet when I left}.",
  "The {sky|weather|conditions} {shifted|changed|turned} from {overcast to partly sunny|cloudy to clear|grey to bright|misty to dry|rainy to dry} {around midday|by the afternoon|as the morning progressed|after lunch}.",
  "There was a {light frost|thin layer of ice|dusting of snow|noticeable chill} on the {ground|windshield|grass|pavement|rooftops} when I {went outside|left the house|opened the door|started my commute} this morning.",
  "The {wind|breeze|air} {picked up|increased|grew stronger|shifted direction|was steady} in the {afternoon|evening|late morning}, {making it feel cooler|carrying leaves across the road|enough to require a jacket|but not enough to cause any disruption}.",
  "The {forecast|weather report|outlook} called for {rain later in the week|temperatures to drop by the weekend|clear skies for the next few days|a mix of sun and cloud|conditions similar to today}.",
  "The {sun|daylight} {set|faded|dropped below the horizon} at {around five-thirty|quarter to six|its usual time for this season}, and {the sky turned a pale orange|the air cooled quickly|the streetlights came on|it was dark within half an hour}.",
  "{Overnight|During the night|Early this morning}, the {temperature dropped|conditions changed|weather shifted|rain arrived}, and by {morning|the time I woke|dawn|the time I left} it was {noticeably cooler|a few degrees lower|wetter than expected}.",
  "The {humidity|moisture in the air} was {higher|lower|about average|noticeable} today, which {made the air feel heavier|kept things within a normal range|was typical for the region|had little practical effect}.",
  "I {noticed|observed|saw} that the {leaves|trees|garden|landscape} were {starting to change color|showing signs of the new season|looking different than a few weeks ago|reflecting the shift in weather}.",
  "The {morning fog|haze|mist|low cloud} {lifted|cleared|burned off|thinned out} by {mid-morning|around ten|the time the sun was fully up|late in the morning}, leaving {clear visibility|a bright sky|standard conditions|dry air} for the rest of the day.",
];

const N_WEATH_C: string[] = [
  "The {conditions|weather|temperature|forecast} for {tomorrow|the rest of the week|the coming days} {are|were} expected to be {similar|much the same|largely unchanged|consistent with today}.",
  "It was the {kind of day|sort of weather|type of conditions} that {required no special preparation|called for a light jacket|did not disrupt any plans|was easy to dress for}.",
  "The {change|shift|difference} from {yesterday|the previous day|earlier in the week} was {minimal|slight|barely noticeable|marginal}.",
  "I {adjusted|adapted|changed} my {plans|route|clothing|timing} {slightly|a little|accordingly} to {account for|accommodate|factor in} the {conditions|weather|temperature}.",
  "{By the time|When} I {arrived|reached my destination|got to where I was going|finished my walk}, the {conditions|weather|sky} had {not changed much|remained steady|stayed consistent|shifted only slightly}.",
  "According to {recorded figures|historical averages|the local station}, this was {within the normal range|close to the seasonal average|not unusual for this period|typical of the region}.",
  "The {sunrise|sunset|daylight hours} {continued|continued} to {change|shift|adjust} {gradually|incrementally|as expected for this time of year}.",
  "There were {no weather-related disruptions|no advisories|no impacts on transportation|no significant events} {reported|observed|noted} for the {area|region|district} today.",
];

// --- Theme 3: Work and school ---

const N_WORK_O: string[] = [
  "The {team meeting|staff meeting|project update|weekly check-in|department briefing} was {scheduled for|held at|set for} {two o'clock|ten in the morning|the usual time|three-thirty|right after lunch}, and the {agenda|topics} included {three items|several updates|a review of current progress|a status report and two new topics}.",
  "I {completed|finished|submitted|turned in} the {assigned report|project deliverable|set of tasks|documentation update} and {sent it|forwarded it|uploaded it} to the {relevant team|appropriate department|project manager|assigned reviewer} {before the deadline|by end of day|on schedule}.",
  "The {schedule|calendar|agenda} for {today|the day|this week} included {a series of meetings|several tasks|training sessions|routine updates|a mix of individual work and group discussions}.",
  "I {attended|joined|participated in|sat in on} a {training session|workshop|seminar|webinar|orientation} on {a new procedure|an updated system|recent policy changes|the latest version of the software}.",
  "The {new employee|recent hire|latest team member} {started|began|joined} {today|this week|on Monday|as scheduled}, and {spent the morning|used the first day|began by} {reviewing documentation|completing orientation paperwork|being introduced to the team}.",
  "I {reviewed|went through|looked over|examined} the {email updates|project notes|task list|shared documents} that had {accumulated|come in|arrived|been posted} {over the weekend|since yesterday|during the morning|overnight}.",
  "The {printer|copier|projector|conference room system|office network} was {out of service|being repaired|unavailable|down for maintenance} for {part of the day|the morning|a few hours}, and {a technician|the IT department|maintenance} was {called|notified|scheduled to address it}.",
  "My {supervisor|manager|team lead|department head} {asked me to|assigned me|requested that I} {prepare a summary|compile data|draft a response|update the spreadsheet|organize the files} for the {upcoming review|next quarter|client presentation|end-of-month submission}.",
  "The {project|initiative|assignment|task} is {currently in|entering|moving into} the {planning|execution|review|testing|documentation} phase, with the {next milestone|deadline|checkpoint} {set for|expected by|scheduled in} {two weeks|the end of the month|next Friday}.",
  "There was a {brief|short|minor|small} {delay|interruption|schedule change|adjustment} to the {afternoon's plan|meeting start|project timeline} due to {a scheduling conflict|a system update|an unexpected request|a room change}.",
  "I {filed|organized|sorted|archived} the {quarterly records|project files|correspondence|department documents} into the {shared drive|filing system|database|designated folder}, as part of the {regular administrative cycle|standard end-of-period process|routine record-keeping}.",
];

const N_WORK_C: string[] = [
  "The rest of the {workday|afternoon|morning|shift} {proceeded|continued|went on} {as scheduled|without interruption|according to plan|at a steady pace}.",
  "I {documented|recorded|logged|noted} the {outcomes|results|decisions|action items} from the {meeting|session|discussion|review} {for reference|in the shared drive|in my notes|for the project record}.",
  "{No major decisions|No urgent items|Nothing requiring immediate action|No critical issues} {arose|came up|emerged|were raised} during the {meeting|session|review|day}.",
  "The {next steps|following actions|remaining items} were {outlined|identified|assigned|listed|clarified} and {distributed|shared|communicated} before {the meeting ended|we adjourned|the session closed}.",
  "I {plan to|intend to|will|expect to} {follow up|continue|resume|revisit} the {remaining items|open tasks|next phase} {tomorrow|next week|at the scheduled time|during the next session}.",
  "The {team|group|department|unit} {appeared to be|was|remained} {on track|within the expected timeline|aligned with the schedule|making steady progress}.",
  "Communication about the {change|update|development|decision} was {sent out|distributed|shared|circulated} to {all relevant parties|the team|stakeholders} {promptly|within the hour|by end of day}.",
  "{Office|Workplace|Building} {conditions|environment|operations} were {normal|standard|as expected|functional} throughout the {day|shift|working hours}.",
];

// --- Theme 4: Transportation ---

const N_TRANS_O: string[] = [
  "The {bus|train|subway|tram|shuttle} {arrived|pulled in|reached the stop} at {approximately|about|roughly|around} {five minutes after|ten minutes past|the expected time|the scheduled time|its usual time on} the {posted schedule|timetable|listed arrival}.",
  "I {drove|took the car|commuted} to the {office|school|appointment|destination}, which took {about thirty-five minutes|roughly half an hour|slightly longer than usual|the expected amount of time|close to forty minutes} {given the traffic|on the standard route|at that time of day}.",
  "The {road|highway|route|main street} was {clear|moderately busy|quieter than usual|about as congested as expected|flowing at a steady pace} for {most of the drive|the majority of the commute|the entire trip}.",
  "I {walked|took the usual path|went on foot|headed} to the {station|stop|office|store} in {about fifteen minutes|the time it usually takes|just under twenty minutes|slightly more time than yesterday}.",
  "The {parking lot|garage|street parking|usual spot} was {about half full|nearly at capacity|emptier than usual|available|mostly occupied} when I {arrived|got there|pulled in} at {my usual time|the expected hour|just before nine}.",
  "I {caught|made|boarded|got on} the {seven-fifteen|eight o'clock|morning|usual|express} {bus|train|ferry|shuttle} and {arrived|reached my stop|got to the station} at {the expected time|the scheduled arrival|about the time I anticipated}.",
  "There was a {minor|brief|short|small} {delay|disruption|slowdown|detour} on the {usual route|highway|main road|rail line} due to {road work|scheduled maintenance|a signal issue|lane closures}, adding {a few minutes|about ten minutes|a short amount of time} to the {journey|commute|trip}.",
  "The {fare|ticket price|cost of the trip|transit charge} was the {standard amount|same as last time|posted rate|expected price}, and {I paid with my transit card|I used the monthly pass|the payment was routine}.",
  "I {filled up|refueled|stopped for fuel for} the {car|vehicle} at the {usual station|nearest pump|station on the way}, and the {price per liter|fuel cost} was {about the same|slightly higher|unchanged|comparable to last time}.",
  "The {flight|train journey|bus ride|ferry crossing} was {on time|running as scheduled|departing according to the timetable|proceeding normally} when I {checked the status|looked at the board|confirmed the details}.",
  "I {transferred|changed|switched} from the {bus to the train|first line to the second|platform three to platform seven|commuter rail to the local service} at the {usual interchange|connection point|transfer station}, and the {wait|connection time|gap between services} was {about {five|eight|ten} minutes|as listed on the schedule|shorter than expected}.",
];

const N_TRANS_C: string[] = [
  "The {journey|commute|trip|ride} was {uneventful|straightforward|routine|without any incidents}.",
  "I {arrived|got there|reached my destination} at {the expected time|approximately when I had planned|the usual time}.",
  "The {return trip|journey home|commute back} was {similar|comparable|about the same|equally straightforward}.",
  "There were {no announcements|no service changes|no disruptions|no notable delays|no issues} {affecting|related to} {my route|the service|the schedule}.",
  "{Traffic|The flow|Congestion|Volume} {remained steady|was consistent|held at normal levels|did not fluctuate significantly} throughout the {commute|trip|drive|journey}.",
  "I {used the time|spent the ride|passed the commute} {listening to a podcast|reading|reviewing notes|looking out the window|going through messages}.",
  "The {vehicle|bus|train car|cabin} was {clean and functional|in standard condition|at a normal temperature|about as full as usual}.",
  "I {made a note|confirmed|checked} the {schedule|timetable|return time|departure time} for {the next day|tomorrow|the following trip|my return}.",
];

// --- Theme 5: Shopping and errands ---

const N_SHOP_O: string[] = [
  "I {went to|stopped by|visited|made a trip to} the {grocery store|supermarket|local market|pharmacy|hardware store} to {pick up|buy|get|purchase} {a few items|some essentials|what was on the list|supplies for the week}.",
  "The {store|shop|market|outlet} was {moderately busy|fairly quiet|about as crowded as expected|open with normal hours} when I {arrived|went in|got there} at {around noon|mid-morning|late afternoon|the usual time}.",
  "I {dropped off|brought in|left} the {dry cleaning|package|repair item|prescription|return} and was {told|informed} it would be {ready by Thursday|available for pickup in two days|processed within the week|completed by the end of the day}.",
  "The {pharmacy|bank|post office|service counter} had my {prescription|paperwork|documents|order} ready, and the {process|transaction|visit} was {completed quickly|handled in the expected time|straightforward|routine}.",
  "I {compared|looked at|checked|reviewed} the {prices|options|available items|selections} for {several products|a few things I needed|the items on my list} and {chose|selected|went with} {the option I usually buy|what fit the budget|the same brand as last time|what was available}.",
  "The {total|bill|cost|amount} at {checkout|the register|the counter|the self-service terminal} was {close to|about|roughly|approximately} what I had {expected|estimated|budgeted for|anticipated}.",
  "I {placed|submitted|finalized} an {online order|delivery request|purchase} for {items I needed|a few things|supplies|products I had been meaning to get}, and the {estimated delivery|shipping time|confirmation} was {within the standard window|about three to five days|as listed on the site}.",
  "The {item|product} I was {looking for|trying to locate|there to buy} was {in stock|available|on the shelf|where I expected it} and I {completed the purchase|picked it up|bought it} without {any issues|difficulty|complication}.",
  "I {returned|exchanged|brought back} {an item|a product|something I had purchased} to the {store|retailer|customer service desk}, and the {return|exchange|transaction} was {handled according to policy|completed routinely|processed in a few minutes}.",
  "The {weekly|regular|usual|routine} {grocery run|shopping trip|supply restock|errand circuit} {took about an hour|was completed in the expected time|went as planned|covered everything on the list}.",
  "I {renewed|picked up|submitted|collected} {my library books|a form at the municipal office|documents from the registry|a package from the collection point|my monthly transit pass} during the {lunch break|morning|afternoon|time between appointments}, which took {about ten minutes|less time than expected|the usual amount of time}.",
];

const N_SHOP_C: string[] = [
  "I {put away|placed|stored|sorted} the {purchases|groceries|items|supplies} {in the kitchen|in their usual places|on the counter|in the pantry} when I {got home|returned|arrived back}.",
  "The {shopping list|list|errands|tasks} had been {fully completed|checked off|covered|taken care of}.",
  "The {receipt|confirmation|documentation} was {filed|saved|placed|stored|kept} for {records|reference|tracking|potential return}.",
  "There were {no issues|no surprises|no complications|nothing unusual} with {any of the purchases|the items|the transactions|the errands}.",
  "The {store|location|branch} I {visited|went to|used} was the {same one I usually go to|nearest location|most convenient option|one on my regular route}.",
  "I {estimated|calculated|noted} that the {total spending|cost for the week|amount spent} was {in line with|close to|about the same as|comparable to} the {usual|average|expected|typical} amount.",
  "{Everything|All items|The goods} appeared to be {in expected condition|as described|correctly priced|within their use-by dates}.",
  "I {added|noted|made a reminder about} {a few items|some things|what was out of stock} to the {list for next time|shopping list|future purchases}.",
];

// --- Theme 6: Observations and information ---

const N_OBS_O: string[] = [
  "The {building|structure|property} across the {street|road|block} has been {under construction|being renovated|having work done|undergoing repairs} since {last month|early in the year|a few weeks ago|the beginning of the quarter}.",
  "I {noticed|observed|saw|noted} that the {store|office|cafe|bank} on {the corner|the main street|the next block} had {changed its hours|updated its signage|rearranged its layout|added new displays}.",
  "The {number|volume|amount} of {people|vehicles|pedestrians|cyclists} at the {intersection|park|station|shopping area} was {about the same as usual|higher than a typical weekday|lower than expected|consistent with the time of day}.",
  "The {new road|construction project|building work|development} near the {office|school|neighborhood|commercial area} appeared to be {progressing|on schedule|in its early stages|about halfway done} based on what I could {see|observe|judge from the outside}.",
  "I {read|saw|came across} that the {local council|city|municipality} had {published|released|posted} {updated figures|new data|the latest statistics|a report} regarding {population|housing|transport|employment} for the {current year|latest quarter|region}.",
  "The {clock|time display|schedule board} in the {office|station|lobby|waiting area} {read|showed|indicated} {three forty-five|just past noon|ten to five|a quarter after two} when I {checked|looked up|glanced at it}.",
  "The {trees|plants|garden|landscaping} along the {street|path|walkway|road} were {beginning to bud|fully leafed out|showing fall colors|bare for the winter|looking much the same as last week}.",
  "I {counted|noted|observed|estimated} that there were {about fifteen|roughly twenty|several|a dozen|around ten} {cars|people|birds|items} {in the area|at the location|along the route|within view}.",
  "The {map|directory|information board|schedule display} at the {entrance|station|terminal|visitor center} had been {updated|replaced|revised} to {reflect recent changes|include new routes|show current information}.",
  "The {mail|post|package|delivery} {arrived|came|was delivered} at {the usual time|about mid-morning|around noon}, {containing|with} {the expected items|a few pieces of standard mail|routine correspondence|bills and a notice}.",
  "The {water meter|electricity meter|gas reading|utility meter} showed a {reading|figure|consumption level} of {approximately the expected amount|a value consistent with last month|a number in the normal range|about what I had estimated for this period}.",
  "The {notice board|announcement area|community bulletin|information panel} at the {entrance|lobby|common area|reception} listed {upcoming events|schedule changes|facility hours|contact information|building policies} that had been {recently updated|posted that week|revised for the new period}.",
];

const N_OBS_C: string[] = [
  "No other {changes|developments|updates|differences} were {apparent|visible|noted|observed} in the {immediate area|surroundings|vicinity|neighborhood}.",
  "The {information|data|details|figures} were {consistent with|in line with|similar to|comparable to} {what had been reported previously|earlier observations|the usual pattern}.",
  "I {made a note|took note|recorded it|logged the observation} for {future reference|my records|comparison later|tracking purposes}.",
  "The {overall state|general condition|appearance|status} of the {area|facility|environment|space} was {unchanged from my last visit|similar to previous observations|about what one would expect}.",
  "It was {a detail|something|an observation|a point} that {did not require any action|was simply part of the surroundings|was worth noting but not acting on}.",
  "The {source|origin|provider} of the information was {the local government|a public database|a posted notice|an official channel}.",
  "I {expect|anticipate|assume} the {situation|condition|arrangement} will {remain the same|continue|persist|be unchanged} for the {foreseeable future|time being|next few weeks}.",
  "There was {nothing about it|no aspect|no element} that {stood out|was unexpected|deviated from the norm|warranted further attention}.",
];

// ============================================================
// Theme configuration
// ============================================================

const DISGUST_THEMES: Theme[] = [
  { openers: D_FOOD_O, continuations: D_FOOD_C },
  { openers: D_HYG_O, continuations: D_HYG_C },
  { openers: D_ENV_O, continuations: D_ENV_C },
  { openers: D_MORAL_O, continuations: D_MORAL_C },
  { openers: D_SOC_O, continuations: D_SOC_C },
  { openers: D_INST_O, continuations: D_INST_C },
];

const NEUTRAL_THEMES: Theme[] = [
  { openers: N_ROUT_O, continuations: N_ROUT_C },
  { openers: N_WEATH_O, continuations: N_WEATH_C },
  { openers: N_WORK_O, continuations: N_WORK_C },
  { openers: N_TRANS_O, continuations: N_TRANS_C },
  { openers: N_SHOP_O, continuations: N_SHOP_C },
  { openers: N_OBS_O, continuations: N_OBS_C },
];

// ============================================================
// Entry generation
// ============================================================

function generateEntries(
  rng: SeededRNG,
  themes: Theme[],
  sentiment: string,
  idPrefix: string,
  count: number,
  banned: string[],
): SyntheticEntry[] {
  const entries: SyntheticEntry[] = [];
  const usedTexts = new Set<string>();
  let idx = 0;
  let attempts = 0;
  const maxAttempts = count * 10; // safety valve

  while (entries.length < count && attempts < maxAttempts) {
    attempts++;

    // Pick a theme
    const theme = themes[rng.nextInt(themes.length)];

    // Decide sentence count: 25% single, 40% double, 25% triple, 10% quad
    const roll = rng.next();
    const numSentences = roll < 0.25 ? 1 : roll < 0.65 ? 2 : roll < 0.90 ? 3 : 4;

    // Build sentences
    const sentences: string[] = [];
    sentences.push(expand(rng, theme.openers[rng.nextInt(theme.openers.length)]));
    for (let s = 1; s < numSentences; s++) {
      sentences.push(expand(rng, theme.continuations[rng.nextInt(theme.continuations.length)]));
    }
    const content = sentences.join(' ');

    // Dedup check
    if (usedTexts.has(content)) continue;

    // Label leakage check
    if (hasLeakage(content, banned)) continue;

    usedTexts.add(content);
    idx++;
    entries.push({
      id: `${idPrefix}${String(idx).padStart(4, '0')}`,
      sentiment,
      content,
    });
  }

  if (entries.length < count) {
    process.stderr.write(
      `WARNING: Only generated ${entries.length}/${count} ${sentiment} entries after ${attempts} attempts.\n`,
    );
  }

  return entries;
}

// ============================================================
// Main
// ============================================================

const SEED = parseInt(process.argv[2] || '2024', 10);
const rng = new SeededRNG(SEED);

process.stdout.write('=== Synthetic Data Generator ===\n\n');
process.stdout.write(`Seed: ${SEED}\n`);
process.stdout.write('Generating DISGUST entries...\n');

const disgustEntries = generateEntries(
  rng, DISGUST_THEMES, 'DISGUST', 'synthetic_disgust_', 1200, DISGUST_BANNED,
);

process.stdout.write(`  Generated: ${disgustEntries.length}\n`);
process.stdout.write('Generating NEUTRAL entries...\n');

const neutralEntries = generateEntries(
  rng, NEUTRAL_THEMES, 'NEUTRAL', 'synthetic_neutral_', 1200, NEUTRAL_BANNED,
);

process.stdout.write(`  Generated: ${neutralEntries.length}\n`);

const allEntries = [...disgustEntries, ...neutralEntries];

// Write output
const outPath = path.resolve(__dirname, '..', 'dataset', 'synthetic_disgust_neutral.json');
fs.writeFileSync(outPath, JSON.stringify(allEntries, null, 2), 'utf-8');

process.stdout.write(`\nTotal: ${allEntries.length} entries\n`);
process.stdout.write(`Output: ${outPath}\n`);

// Distribution summary
const disgustThemeDist: Record<number, number> = {};
const neutralThemeDist: Record<number, number> = {};

// Sentence length distribution
const sentLengths: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
for (const e of allEntries) {
  const sCount = e.content.split(/\.\s+/).filter(s => s.trim().length > 0).length;
  const bucket = Math.min(sCount, 4);
  sentLengths[bucket] = (sentLengths[bucket] || 0) + 1;
}

process.stdout.write('\nSentence length distribution (approx):\n');
for (const [len, count] of Object.entries(sentLengths)) {
  process.stdout.write(`  ${len} sentence(s): ${count}\n`);
}

// Label leakage final scan
let leakageCount = 0;
for (const e of disgustEntries) {
  if (hasLeakage(e.content, DISGUST_BANNED)) leakageCount++;
}
for (const e of neutralEntries) {
  if (hasLeakage(e.content, NEUTRAL_BANNED)) leakageCount++;
}
process.stdout.write(`\nLabel leakage violations: ${leakageCount}\n`);
process.stdout.write('\n=== Done ===\n');
