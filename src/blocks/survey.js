// Dynamic survey block module supporting text, radio, checkbox, dropdown, and Likert inputs
import { getNextParticipantId, getNextSessionNumber, getParticipantDetails } from '../firebase.js';

function getResponseValue(partData, name) {
    if (!partData || !partData.response) return null;
    const response = partData.response;
    if (Array.isArray(response)) {
        const item = response.find(x => x.name === name);
        return item ? item.value : null;
    }
    return response[name] || null;
}

export function generateHtmlForm(questions, defaultValues = {}) {
    if (!questions || !Array.isArray(questions)) return '';

    let html = '<div class="custom-jspsych-form" style="text-align: left; max-width: 550px; margin: 0 auto; padding: 25px; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37); backdrop-filter: blur(8px); color: #f8fafc; font-family: \'Inter\', sans-serif;">';

    questions.forEach((q) => {
        const requiredAttr = q.required ? 'required' : '';
        const type = q.type || (q.options && q.options.length > 0 ? 'multi-choice' : 'text');

        html += `<div style="margin-bottom: 24px;">`;
        html += `<label style="display: block; font-weight: 600; font-size: 0.95rem; margin-bottom: 8px; color: #f1f5f9;">${q.prompt}</label>`;

        if (q.name === 'participant_id') {
            const val = defaultValues.participant_id || '001';
            html += `
                <div style="display: flex; align-items: center; gap: 6px; background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; padding: 2px 8px; transition: border-color 0.2s;" onfocusin="this.style.borderColor='#8b5cf6';" onfocusout="this.style.borderColor='rgba(255, 255, 255, 0.15)';">
                    <span style="color: #94a3b8; font-weight: 600; font-size: 0.9rem; user-select: none;">sub-</span>
                    <input type="text" name="participant_id" id="participant_id_input" ${requiredAttr} pattern="[0-9]{1,3}" title="Please enter an integer less than 1000" placeholder="001" value="${val}" style="flex: 1; padding: 10px 4px 10px 0; background: transparent; border: none; color: #f8fafc; font-size: 0.9rem; outline: none; box-sizing: border-box;">
                </div>
            `;
        } else if (q.name === 'session_number') {
            const val = defaultValues.session_number || '01';
            html += `
                <div style="display: flex; align-items: center; gap: 6px; background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; padding: 2px 8px; transition: border-color 0.2s;" onfocusin="this.style.borderColor='#8b5cf6';" onfocusout="this.style.borderColor='rgba(255, 255, 255, 0.15)';">
                    <span style="color: #94a3b8; font-weight: 600; font-size: 0.9rem; user-select: none;">ses-</span>
                    <input type="text" name="session_number" id="session_number_input" ${requiredAttr} pattern="[0-9]{1,2}" title="Please enter a 2-digit max integer" placeholder="01" value="${val}" style="flex: 1; padding: 10px 4px 10px 0; background: transparent; border: none; color: #f8fafc; font-size: 0.9rem; outline: none; box-sizing: border-box;">
                </div>
            `;
        } else if (q.name === 'age') {
            html += `
                <input type="number" name="age" min="1" max="120" step="1" ${requiredAttr} placeholder="Enter age (e.g. 25)..." style="width: 100%; padding: 10px 12px; background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; color: #f8fafc; font-size: 0.9rem; outline: none; box-sizing: border-box; transition: border-color 0.2s;" onfocus="this.style.borderColor='#8b5cf6';" onblur="this.style.borderColor='rgba(255, 255, 255, 0.15)';">
            `;
        } else if (type === 'multi-choice' && q.options) {
            q.options.forEach((opt) => {
                html += `
                    <label style="display: flex; align-items: center; font-weight: normal; font-size: 0.9rem; margin-top: 8px; cursor: pointer; color: #cbd5e1; user-select: none;">
                        <input type="radio" name="${q.name}" value="${opt}" ${requiredAttr} style="margin-right: 10px; cursor: pointer; width: 16px; height: 16px; accent-color: #8b5cf6;">
                        <span>${opt}</span>
                    </label>
                `;
            });
        } else if (type === 'multi-select' && q.options) {
            q.options.forEach((opt) => {
                html += `
                    <label style="display: flex; align-items: center; font-weight: normal; font-size: 0.9rem; margin-top: 8px; cursor: pointer; color: #cbd5e1; user-select: none;">
                        <input type="checkbox" name="${q.name}" value="${opt}" style="margin-right: 10px; cursor: pointer; width: 16px; height: 16px; accent-color: #8b5cf6;">
                        <span>${opt}</span>
                    </label>
                `;
            });
        } else if (type === 'dropdown' && q.options) {
            html += `
                <select name="${q.name}" ${requiredAttr} style="width: 100%; padding: 10px 12px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; color: #f8fafc; font-size: 0.9rem; outline: none; margin-top: 4px; box-sizing: border-box; cursor: pointer;">
                    <option value="" disabled selected hidden>Select an option...</option>
            `;
            q.options.forEach(opt => {
                html += `<option value="${opt}" style="background: #0f172a; color: #f8fafc;">${opt}</option>`;
            });
            html += `</select>`;
        } else if (type === 'likert' && q.options) {
            html += `<div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; gap: 8px;">`;
            q.options.forEach((opt) => {
                html += `
                    <label style="display: flex; flex-direction: column; align-items: center; cursor: pointer; font-size: 0.8rem; color: #cbd5e1; flex: 1; text-align: center; user-select: none;">
                        <span style="margin-bottom: 6px; min-height: 2.2rem; display: flex; align-items: flex-end; justify-content: center; line-height: 1.2; word-break: break-word;">${opt}</span>
                        <input type="radio" name="${q.name}" value="${opt}" ${requiredAttr} style="cursor: pointer; width: 16px; height: 16px; accent-color: #8b5cf6;">
                    </label>
                `;
            });
            html += `</div>`;
        } else {
            html += `
                <input type="text" name="${q.name}" ${requiredAttr} placeholder="Enter your response..." style="width: 100%; padding: 10px 12px; background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; color: #f8fafc; font-size: 0.9rem; outline: none; box-sizing: border-box; transition: border-color 0.2s;" onfocus="this.style.borderColor='#8b5cf6';" onblur="this.style.borderColor='rgba(255, 255, 255, 0.15)';">
            `;
        }

        html += `</div>`;
    });

    html += '</div>';
    return html;
}

export async function createTimeline(blockConfig) {
    const timeline = [];
    const formsFile = blockConfig.config?.forms_file || 'forms.yaml';
    let formsList = [];

    try {
        const response = await fetch(formsFile);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${formsFile}: ${response.statusText}`);
        }
        const yamlText = await response.text();
        if (typeof jsyaml !== 'undefined') {
            const parsed = jsyaml.load(yamlText);
            formsList = parsed.forms || [];
        }
    } catch (error) {
        console.error("Error loading forms from YAML inside survey block, using defaults:", error);
        formsList = [
            {
                id: "participant",
                questions: [
                    { prompt: "Participant ID:", name: 'participant_id', required: true },
                    { prompt: "Age:", name: 'age', required: true }
                ]
            }
        ];
    }

    const targetFormId = blockConfig.config?.form_id;
    if (targetFormId) {
        formsList = formsList.filter(form => form.id === targetFormId);
        if (formsList.length === 0) {
            console.warn(`[Survey Block] Form ID "${targetFormId}" not found in ${formsFile}`);
        }
    }

    formsList.forEach(form => {
        const defaultValues = {};
        if (form.id === 'participant') {
            defaultValues.participant_id = "001";
        }

        timeline.push({
            type: jsPsychSurveyHtmlForm,
            html: generateHtmlForm(form.questions, defaultValues),
            button_label: "Continue",
            dataAsArray: true,
            on_load: function() {
                if (form.id === 'participant') {
                    const idInput = document.getElementById('participant_id_input');
                    if (idInput) {
                        const handleIdChange = async () => {
                            const enteredVal = idInput.value.trim();
                            if (!enteredVal) return;
                            const parsedNum = parseInt(enteredVal, 10);
                            if (isNaN(parsedNum)) return;
                            const formattedId = "sub-" + String(parsedNum).padStart(3, '0');
                            
                            try {
                                const details = await getParticipantDetails(formattedId);
                                if (details) {
                                    console.log(`[Auto-population] Found pre-existing details for ${formattedId}:`, details);
                                    
                                    // 1. Age
                                    const ageInput = document.querySelector('input[name="age"]');
                                    if (ageInput && details.age !== undefined) {
                                        ageInput.value = details.age;
                                    }
                                    
                                    // 2. Gender (Radio)
                                    if (details.gender) {
                                        const genderRadios = document.querySelectorAll('input[name="gender"]');
                                        genderRadios.forEach(radio => {
                                            radio.checked = (radio.value === details.gender);
                                        });
                                    }
                                    
                                    // 3. Preferred Devices (Checkboxes)
                                    if (details.devices) {
                                        const selectedDevices = typeof details.devices === 'string' 
                                            ? details.devices.split(';') 
                                            : (Array.isArray(details.devices) ? details.devices : [details.devices]);
                                        
                                        const deviceCheckboxes = document.querySelectorAll('input[name="devices"]');
                                        deviceCheckboxes.forEach(checkbox => {
                                            checkbox.checked = selectedDevices.includes(checkbox.value);
                                        });
                                    }
                                    
                                    // 4. Language (Dropdown/Select)
                                    if (details.language) {
                                        const langSelect = document.querySelector('select[name="language"]');
                                        if (langSelect) {
                                            langSelect.value = details.language;
                                        }
                                    }
                                }
                            } catch (err) {
                                console.error("Error auto-populating participant details:", err);
                            }
                        };

                        idInput.addEventListener('input', handleIdChange);
                        idInput.addEventListener('change', handleIdChange);

                        // Async fetch the next participant ID in the background
                        (async () => {
                            try {
                                const nextPartId = await getNextParticipantId();
                                idInput.value = nextPartId;
                                handleIdChange();
                            } catch (e) {
                                console.error("Error setting next participant ID on load:", e);
                                handleIdChange();
                            }
                        })();
                    }
                }
                if (form.id === 'session') {
                    // Dynamically query and update session number based on current participant_id
                    (async () => {
                        try {
                            const partData = jsPsych.data.get().filter({ formId: 'participant' }).last().values()[0];
                            console.log("[Autofill Debug] partData retrieved:", partData);
                            const rawPartId = getResponseValue(partData, 'participant_id');
                            console.log("[Autofill Debug] rawPartId retrieved:", rawPartId);
                            if (rawPartId) {
                                let enteredPartId = rawPartId;
                                if (typeof rawPartId === 'string' && !rawPartId.startsWith('sub-')) {
                                    const parsedNum = parseInt(rawPartId, 10);
                                    enteredPartId = "sub-" + (isNaN(parsedNum) ? "001" : String(parsedNum).padStart(3, '0'));
                                } else if (typeof rawPartId !== 'string') {
                                    const parsedNum = parseInt(rawPartId, 10);
                                    enteredPartId = "sub-" + (isNaN(parsedNum) ? "001" : String(parsedNum).padStart(3, '0'));
                                }
                                console.log("[Autofill Debug] query enteredPartId:", enteredPartId);
                                const nextSessionNum = await getNextSessionNumber(enteredPartId);
                                console.log("[Autofill Debug] nextSessionNum resolved:", nextSessionNum);
                                const sessionInput = document.getElementById('session_number_input');
                                if (sessionInput) {
                                    sessionInput.value = nextSessionNum;
                                }
                            }
                        } catch (e) {
                            console.error("Failed to dynamically set session number:", e);
                        }
                    })();
                }
            },
            data: {
                ...(form.data || {}),
                formId: form.id
            }
        });
    });

    return timeline;
}
