// One JSON object per line; the format of the raw event log everywhere (files, sourcedata).
export const eventsJsonl = (events) => `${events.map((event) => JSON.stringify(event)).join('\n')}${events.length ? '\n' : ''}`;
