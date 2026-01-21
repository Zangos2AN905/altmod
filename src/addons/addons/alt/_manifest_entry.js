export default {
    editorOnly: true,
    name: "Alt",
    description: "Alt watches over your shoulder and makes sarcastic observations about what you're doing. They're a digital monochrome lifeform who serves as a tutorial supervisor.",
    tags: ["community", "beta"],
    userscripts: [
        {
            url: "userscript.js"
        }
    ],
    userstyles: [
        {
            url: "style.css"
        }
    ],
    settings: [
        {
            dynamic: true,
            name: "Comment Frequency",
            id: "frequency",
            type: "select",
            default: "medium",
            potentialValues: [
                { "id": "low", "name": "Low" },
                { "id": "medium", "name": "Medium" },
                { "id": "high", "name": "High" },
                { "id": "chaotic", "name": "Chaotic" }
            ]
        },
        {
            dynamic: true,
            name: "Enable Headpats",
            id: "headpats",
            type: "boolean",
            default: true
        }
    ],
    enabledByDefault: true
};
