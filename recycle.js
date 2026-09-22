// Track focus history
let currentInput = null;

document.addEventListener('focusin', (e) => {
  if (e.target.tagName === 'INPUT') {
    currentInput = e.target;
  }
});

// Helper: Get all interactive input fields in the table
function getInputs() {
  return Array.from(document.querySelectorAll('.nav-toolbar ~ container input, input[type="text"], input[type="number"]'))
              .filter(input => !input.disabled && input.offsetWidth > 0);
}

// 🔁 Move pointer forward to the next input field
document.getElementById('btnNextField').addEventListener('click', () => {
  const inputs = getInputs();
  if (inputs.length === 0) return;
  
  let index = inputs.indexOf(currentInput);
  let nextIndex = (index + 1) % inputs.length;
  inputs[nextIndex].focus();
});

// ⬇️ Move down to the input field directly below in the same column
document.getElementById('btnNextRow').addEventListener('click', () => {
  const inputs = getInputs();
  if (!currentInput) return;

  const currentRow = currentInput.closest('.row, tr, div');
  if (!currentRow) return;

  const currentCellIndex = Array.from(currentRow.children).findIndex(child => child.contains(currentInput));
  const nextRow = currentRow.nextElementSibling;

  if (nextRow) {
    const targetCell = nextRow.children[currentCellIndex];
    const targetInput = targetCell ? targetCell.querySelector('input') : null;
    if (targetInput) targetInput.focus();
  }
});

// ↩️ Shift focus between middle/meter field and last row input
document.getElementById('btnJumpEnd').addEventListener('click', () => {
  const inputs = getInputs();
  if (inputs.length === 0) return;

  const lastInput = inputs[inputs.length - 1];
  const midIndex = Math.floor(inputs.length / 2);
  const midInput = inputs[midIndex];

  if (document.activeElement === lastInput) {
    midInput.focus();
  } else {
    lastInput.focus();
  }
});