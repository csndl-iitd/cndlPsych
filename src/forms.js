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
