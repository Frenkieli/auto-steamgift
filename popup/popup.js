document.querySelector('form').addEventListener('submit', e => {
  e.preventDefault();
  const formData = new FormData(e.target);

  chrome.storage.sync.set({
    restricted: {
      trigger: !!formData.get('formRestrictedCheckBox'),
      value: formData.get('formRestrictedScore')
    },
    whitelist: {
      trigger: !!formData.get('formWhitelistCheckBox'),
      value: formData.get('formWhitelistScore')
    },
    group: {
      trigger: !!formData.get('formGroupCheckBox'),
      value: formData.get('formGroupScore')
    },
    level: {
      trigger: !!formData.get('formLevelCheckBox'),
      value: formData.get('formLevelScore')
    },
    cost: {
      trigger: !!formData.get('formCostCheckBox'),
      value: formData.get('formCostScore')
    },
    autoScore: {
      trigger: !!formData.get('formAutoScoreCheckBox')
    },
    autoStart: {
      trigger: !!formData.get('formAutoStartCheckBox')
    }
  });

  window.close();
})
