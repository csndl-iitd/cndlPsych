import { logger } from "../logger.js";
import { HtmlKeyboardTouchResponsePlugin } from '../plugins/html-keyboard-touch-response.js';

function shuffleArray(array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function randomPosition(existing, minDistance, margin) {

    const width = window.innerWidth;
    const height = window.innerHeight;

    while (true) {

        const x = Math.random() * (width - 2 * margin) + margin;
        const y = Math.random() * (height - 2 * margin) + margin;

        let valid = true;

        for (const p of existing) {

            const dx = x - p.x;
            const dy = y - p.y;

            if (Math.sqrt(dx * dx + dy * dy) < minDistance) {
                valid = false;
                break;
            }
        }

        if (valid)
            return { x, y };
    }
}

export async function createTimeline(blockConfig) {

    const config = blockConfig.config || {};

    const nTrials = config.n_trials || 10;
    const fixationDuration = config.fixation_duration || 1000;
    const maxSearchTime = config.max_search_time || 10000;
    const iti = config.iti || 1250;
    const targets = config.targets || 2;
    const distractors = config.distractors || 10;
    const minimumDistance = config.minimum_distance || 140;
    const margin = config.margin || 80;

    const timeline = [];

    timeline.push({

        type: HtmlKeyboardTouchResponsePlugin,

        stimulus: `
        <div style="
            max-width:800px;
            margin:auto;
            text-align:left;
            font-size:28px;
            line-height:1.6;
            color:white;
        ">
            <h2 style="text-align:center;">Visual Search Task</h2>

            <p>
            In every trial you will see several symbols randomly arranged on the screen.
            </p>

            <p>
            There are <strong>two target symbols (E)</strong>.
            </p>

            <p>
            All remaining symbols are distractors (<strong>Ǝ</strong>).
            </p>

            <p>
            <strong>On computers: </strong>Search the display until you have located <strong>both E's</strong>. Once you have found both targets,
            <strong>press the SPACEBAR</strong>.
            </p>

            <p>
            <strong>On tablets and phones: </strong>Search the display and tap on both the <strong>E's</strong> as quickly as possible.
            </p>

            <p>
            Try to respond as quickly and accurately as possible.
            </p>

            <br>

            <p style="text-align:center;">
            <strong>Press SPACEBAR to begin.</strong>
            </p>

        </div>
        `,

        choices: [" "]

    });

    for (let trial = 0; trial < nTrials; trial++) {


        //-------------------------------------------------
        // FIXATION
        //-------------------------------------------------

        timeline.push({

            type: HtmlKeyboardTouchResponsePlugin,

            stimulus:
                '<div style="font-size:60px; color:white;">+</div>',

            choices: "NO_KEYS",

            trial_duration: fixationDuration,

            on_load: function () {
                //logger.dispatchTrigger(30);   // Trial start

                logger.dispatchTrigger(30);  // Fixation start
            }
        });

        //-------------------------------------------------
        // SEARCH ARRAY
        //-------------------------------------------------

        const symbols = [];

        for (let i = 0; i < targets; i++)
            symbols.push("E");

        for (let i = 0; i < distractors; i++)
            symbols.push("Ǝ");

        shuffleArray(symbols);

        const positions = [];

        let html = `
        <div style="
        position:relative;
        width:100vw;
        height:100vh;
        ">
        `;

        for (const symbol of symbols) {

            const pos = randomPosition(
                positions,
                minimumDistance,
                margin
            );

            positions.push(pos);

            const isTarget = symbol === "E";

            html += `
            <div
                class="${isTarget ? 'visual-search-target' : 'visual-search-distractor'}"
                style="
                    position:absolute;
                    left:${pos.x}px;
                    top:${pos.y}px;
                    transform:translate(-50%,-50%);
                    white-space:pre;
                    font-family:'Courier New', monospace;
                    font-size:28px;
                    line-height:1;
                    text-align:center;
                    user-select:none;
                    color:white;
                    ${isTarget ? 'cursor:pointer;' : ''}
                ">
            ###
            #${symbol}#
            ###
            </div>
            `;
        }

        html += `
        </div>
        `;

        timeline.push({

            type: HtmlKeyboardTouchResponsePlugin,

            stimulus: html,

            on_load: function () {
                logger.dispatchTrigger(31);
                
                // Add visual feedback when targets are tapped
                const targets = document.querySelectorAll(".visual-search-target");
                targets.forEach(t => t.addEventListener("pointerdown", (e) => {
                    e.currentTarget.style.color = "#ffcc00";
                }));
            },

            choices: [" "],

            touch_mapping: [
                { type: "selector", selector: ".visual-search-target", require: 2, key: " " }
            ],

            trial_duration: maxSearchTime,

            response_ends_trial: true,

            data: {

                task: "visual_search",

                trial: trial + 1,

                positions: positions
            },

            on_finish: function (data) {

                if (data.response !== null) {
                    logger.dispatchTrigger(32);
                }

                logger.dispatchTrigger(33);
            }



        });

        //-------------------------------------------------
        // ITI
        //-------------------------------------------------

        timeline.push({

            type: HtmlKeyboardTouchResponsePlugin,

            stimulus: "",

            choices: "NO_KEYS",

            trial_duration: iti
        });

    }

    return timeline;
}
