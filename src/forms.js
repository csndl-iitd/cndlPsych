// Defines jsPsych timelines for registration and psychometric forms
export function getRegistrationTimeline() {
    return {
        type: jsPsychSurveyText,
        questions: [
            { prompt: "Participant ID:", name: 'participant_id', required: true },
            { prompt: "Age:", name: 'age', required: true }
        ],
        data: { phase: 'registration' }
    };
}

export function getPsychometricTimeline() {
    return {
        type: jsPsychSurveyMultiChoice,
        questions: [
            {
                prompt: "How are you feeling today?", 
                name: 'feeling', 
                options: ['Very Bad', 'Bad', 'Neutral', 'Good', 'Very Good'], 
                required: true
            }
        ],
        data: { phase: 'psychometric' }
    };
}

const pluginMap = {
    'survey-text': jsPsychSurveyText,
    'survey-multi-choice': jsPsychSurveyMultiChoice
};

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
        const pluginClass = pluginMap[form.type];
        if (!pluginClass) {
            throw new Error(`Unsupported form type in YAML: ${form.type}`);
        }
        return {
            type: pluginClass,
            questions: form.questions,
            data: form.data || {}
        };
    });
}
