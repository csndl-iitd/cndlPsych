// Defines jsPsych timelines for registration and psychometric forms using dynamic HTML5 rendering

export function generateHtmlForm(questions) {
    if (!questions || !Array.isArray(questions)) return '';

    let html = '<div class="custom-jspsych-form" style="text-align: left; max-width: 550px; margin: 0 auto; padding: 25px; background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37); backdrop-filter: blur(8px); color: #f8fafc; font-family: \'Inter\', sans-serif;">';
    
    questions.forEach((q) => {
        const requiredAttr = q.required ? 'required' : '';
        const type = q.type || (q.options && q.options.length > 0 ? 'multi-choice' : 'text');

        html += `<div style="margin-bottom: 24px;">`;
        html += `<label style="display: block; font-weight: 600; font-size: 0.95rem; margin-bottom: 8px; color: #f1f5f9;">${q.prompt}</label>`;

        if (type === 'multi-choice' && q.options) {
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

export function getRegistrationTimeline() {
    const questions = [
        { prompt: "Participant ID:", name: 'participant_id', required: true },
        { prompt: "Age:", name: 'age', required: true }
    ];
    return {
        type: jsPsychSurveyHtmlForm,
        html: generateHtmlForm(questions),
        button_label: "Continue",
        dataAsArray: true,
        data: { phase: 'registration', formId: 'participant' }
    };
}

export function getPsychometricTimeline() {
    const questions = [
        {
            prompt: "How are you feeling today?", 
            name: 'feeling', 
            type: 'multi-choice',
            options: ['Very Bad', 'Bad', 'Neutral', 'Good', 'Very Good'], 
            required: true
        }
    ];
    return {
        type: jsPsychSurveyHtmlForm,
        html: generateHtmlForm(questions),
        button_label: "Continue",
        dataAsArray: true,
        data: { phase: 'psychometric', formId: 'psychometric' }
    };
}

export async function loadFormsFromYaml(yamlPath = 'forms.yaml') {
    try {
        const response = await fetch(yamlPath);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${yamlPath}: ${response.statusText}`);
        }
        const yamlText = await response.text();
        if (typeof jsyaml === 'undefined') {
            throw new Error('jsyaml library is not loaded');
        }
        const parsed = jsyaml.load(yamlText);
        return parsed.forms || [];
    } catch (error) {
        console.error("Error loading forms from YAML:", error);
        return null;
    }
}

export function generateTimelineFromForms(formsList) {
    if (!formsList || !Array.isArray(formsList)) return [];
    return formsList.map(form => {
        return {
            type: jsPsychSurveyHtmlForm,
            html: generateHtmlForm(form.questions),
            button_label: "Continue",
            dataAsArray: true,
            data: {
                ...(form.data || {}),
                formId: form.id
            }
        };
    });
}
