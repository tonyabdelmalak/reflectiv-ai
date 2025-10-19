// Emotional Intelligence (EI) Mode Replacement Code for ReflectivAI Chat/Coach
(function() {
  // Define HCP personas with emotional profiles
  const personas = [
    { name: "Difficult HCP", profile: ["gruff", "skeptical", "time-pressured"] },
    { name: "Nice but Doesn\u2019t Prescribe", profile: ["friendly", "polite", "hesitant"] },
    { name: "Busy HCP", profile: ["rushed", "demanding", "overloaded"] },
    { name: "Highly Engaged HCP", profile: ["curious", "collaborative", "enthusiastic"] },
    { name: "Cautious HCP", profile: ["cautious", "doubtful", "insecure"] }
  ];

  // Define Emotional Intelligence features
  const eiFeatures = ["Empathy Rating", "Stress Level Indicator", "Active Listening Score"];
  
  // Create or get EI mode container
  let eiContainer = document.getElementById("ei-mode-container");
  if (!eiContainer) {
    eiContainer = document.createElement("div");
    eiContainer.id = "ei-mode-container";
    document.body.appendChild(eiContainer); // Append to the appropriate parent
  }
  // Clear any existing content
  eiContainer.innerHTML = "";

  // Create persona dropdown
  const personaLabel = document.createElement("label");
  personaLabel.innerText = "Select HCP Persona: ";
  const personaDropdown = document.createElement("select");
  personaDropdown.id = "personaDropdown";
  personaDropdown.innerHTML = "<option value=\"\">--Select Persona--</option>";
  personas.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.text = p.name;
    personaDropdown.appendChild(opt);
  });
  eiContainer.appendChild(personaLabel);
  eiContainer.appendChild(personaDropdown);

  // Create EI feature dropdown
  const featureLabel = document.createElement("label");
  featureLabel.innerText = " Select EI Feature: ";
  const featureDropdown = document.createElement("select");
  featureDropdown.id = "featureDropdown";
  featureDropdown.innerHTML = "<option value=\"\">--Select Feature--</option>";
  eiFeatures.forEach(f => {
    const opt = document.createElement("option");
    opt.value = f;
    opt.text = f;
    featureDropdown.appendChild(opt);
  });
  eiContainer.appendChild(featureLabel);
  eiContainer.appendChild(featureDropdown);

  // Create user response input (textarea) for conversation simulation
  const responseLabel = document.createElement("label");
  responseLabel.innerText = "Your Response to HCP: ";
  const responseInput = document.createElement("textarea");
  responseInput.id = "userResponseInput";
  responseInput.rows = 3;
  responseInput.cols = 40;
  responseInput.placeholder = "Type your response to the HCP here...";
  eiContainer.appendChild(document.createElement("br"));
  eiContainer.appendChild(responseLabel);
  eiContainer.appendChild(responseInput);

  // Create feedback generation button
  const genButton = document.createElement("button");
  genButton.id = "generateFeedbackButton";
  genButton.innerText = "Generate Feedback";
  eiContainer.appendChild(document.createElement("br"));
  eiContainer.appendChild(genButton);

  // Create feedback display area
  const feedbackDiv = document.createElement("div");
  feedbackDiv.id = "feedbackDisplay";
  feedbackDiv.style.marginTop = "1em";
  eiContainer.appendChild(feedbackDiv);

  // Calculate Empathy Rating (0-5) based on persona profile and user response
  function calculateEmpathyRating(persona, userResponse) {
    if (!persona || !userResponse) return 0;
    let score = 0;
    // Base score influenced by persona (difficult/busy start lower)
    const baseScores = {
      "Difficult HCP": 1,
      "Busy HCP": 1,
      "Cautious HCP": 2,
      "Nice but Doesn\u2019t Prescribe": 2,
      "Highly Engaged HCP": 3
    };
    score += baseScores[persona] || 1;
    // Add points for empathic keywords in user response
    const empathyKeywords = ["understand", "appreciate", "concern", "feel", "sorry", "empathize", "hear you"];
    const text = userResponse.toLowerCase();
    empathyKeywords.forEach(kw => {
      if (text.includes(kw)) score += 1;
    });
    // Cap to 5
    return Math.min(score, 5);
  }

  // Calculate Stress Level Indicator (High/Medium/Low) based on persona
  function calculateStressLevel(persona) {
    // Base stress on persona: difficult or busy HCPs are high stress
    const highStressPersonas = ["Difficult HCP", "Busy HCP"];
    const mediumStressPersonas = ["Cautious HCP", "Nice but Doesn\u2019t Prescribe"];
    if (highStressPersonas.includes(persona)) return "High";
    if (mediumStressPersonas.includes(persona)) return "Medium";
    return "Low";
  }

  // Calculate Active Listening Score (0-5) by checking user response for engagement
  function calculateActiveListeningScore(userResponse) {
    if (!userResponse) return 0;
    let score = 0;
    // Count question marks as open questions asked
    const questionCount = (userResponse.match(/\?/g) || []).length;
    score += Math.min(questionCount, 3);
    // Check for reflective phrases in response
    const listeningKeywords = ["what makes", "how do you", "tell me more", "why is", "you feel"];
    const text = userResponse.toLowerCase();
    listeningKeywords.forEach(kw => {
      if (text.includes(kw)) score += 1;
    });
    return Math.min(score, 5);
  }

  // Generate feedback based on persona, feature, and user response
  function generateFeedback(persona, feature, userResponse) {
    let output = "";
    if (feature === "Empathy Rating") {
      const empathyScore = calculateEmpathyRating(persona, userResponse);
      output = `<strong>Empathy: ${empathyScore}/5</strong> — `;
      // Context-aware suggestions per persona
      if (persona === "Difficult HCP") {
        output += "Remain calm and acknowledge any frustration. Use phrases like \"I can see this is challenging...\" to show understanding.";
      } else if (persona === "Nice but Doesn\u2019t Prescribe") {
        output += "Approach with basic empathy first, then pivot. Emphasize patient impact: \"I understand those concerns, thank you. How do you think this can help your patients feel better?\"";
      } else if (persona === "Busy HCP") {
        output += "Be concise but warm. Acknowledge time pressure: \"I know you're busy, I appreciate your time. Let's see how we can help your patients efficiently.\"";
      } else if (persona === "Highly Engaged HCP") {
        output += "Maintain enthusiasm and collaboration. Affirm their engagement: \"It's great to see your interest; let's explore how this can benefit your patients together.\"";
      } else if (persona === "Cautious HCP") {
        output += "Be reassuring and patient. Express understanding: \"I hear your caution; let's address any doubts you may have.\"";
      } else {
        output += "Show genuine understanding and a caring response.";
      }
    } else if (feature === "Stress Level Indicator") {
      const stressLevel = calculateStressLevel(persona);
      output = `<strong>Stress Level: ${stressLevel}</strong> — `;
      if (stressLevel === "High") {
        output += "The HCP seems stressed. Use calm, reassuring language, acknowledge their workload, and keep communication brief.";
      } else if (stressLevel === "Medium") {
        output += "The HCP may have concerns. Stay empathetic and thorough, addressing any doubts gently.";
      } else {
        output += "The HCP appears relaxed. Use a friendly, positive tone to reinforce rapport.";
      }
    } else if (feature === "Active Listening Score") {
      const listeningScore = calculateActiveListeningScore(userResponse);
      output = `<strong>Active Listening: ${listeningScore}/5</strong> — `;
      if (listeningScore < 2) {
        output += "Try asking more open-ended questions or reflecting on what the HCP says (e.g., \"What do you feel is most important about this?\").";
      } else {
        output += "Good job engaging! Continue to listen actively and address the HCP's concerns.";
      }
    } else {
      output = "Select a valid EI feature to get feedback.";
    }
    return output;
  }

  // Event listener: generate feedback on button click
  genButton.addEventListener("click", function() {
    const persona = personaDropdown.value;
    const feature = featureDropdown.value;
    const userMsg = responseInput.value.trim();
    if (!persona || !feature) {
      feedbackDiv.innerHTML = "<em>Please select both a persona and an EI feature.</em>";
      return;
    }
    const feedback = generateFeedback(persona, feature, userMsg);
    feedbackDiv.innerHTML = feedback;
  });

  // (Optional) Example: Hook into chat input for real-time analysis
  // If there is a chat input element, we could listen for 'Enter' and update feedback live.
  const chatInput = document.getElementById("chatInput"); 
  if (chatInput) {
    chatInput.addEventListener("keydown", function(event) {
      if (event.key === "Enter") {
        const userText = chatInput.value.trim();
        // Compute and display empathy feedback on each message (if needed).
        const persona = personaDropdown.value;
        const feature = "Empathy Rating"; // e.g., auto-use empathy
        const realTimeFeedback = generateFeedback(persona, feature, userText);
        console.log("Real-Time Feedback:", realTimeFeedback);
        // (In practice, display this in the UI instead of console.)
      }
    });
  }
})();
