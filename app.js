// ============================================
// FITNESS TRAINER - Production Application
// Real-time pose detection with MediaPipe Pose
// ============================================

// Authentication System
class AuthSystem {
    constructor() {
        this.currentUser = null;
        this.users = JSON.parse(localStorage.getItem('fitness_users') || '[]');
        this.loadCurrentUser();
    }

    loadCurrentUser() {
        // Always load user if logged in (always remember)
        const userId = localStorage.getItem('current_user_id');
        if (userId) {
            this.currentUser = this.users.find(u => u.id === userId) || null;
        }
    }

    register(name, email, password) {
        if (this.users.find(u => u.email === email)) {
            return { success: false, message: 'Email already registered' };
        }

        const user = {
            id: Date.now().toString(),
            name,
            email,
            password, // In production, hash this
            registeredAt: new Date().toISOString()
        };

        this.users.push(user);
        localStorage.setItem('fitness_users', JSON.stringify(this.users));
        this.login(email, password);
        return { success: true, user };
    }

    login(email, password) {
        const user = this.users.find(u => u.email === email && u.password === password);
        if (user) {
            this.currentUser = user;
            localStorage.setItem('current_user_id', user.id);
            return { success: true, user };
        }
        return { success: false, message: 'Invalid email or password' };
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('current_user_id');
    }

    isAuthenticated() {
        return this.currentUser !== null;
    }

    getUserCalendar() {
        if (!this.currentUser) return null;
        const key = `calendar_${this.currentUser.id}`;
        return JSON.parse(localStorage.getItem(key) || '{}');
    }

    saveCalendar(calendarData) {
        if (!this.currentUser) return;
        const key = `calendar_${this.currentUser.id}`;
        localStorage.setItem(key, JSON.stringify(calendarData));
    }

    checkIn(day) {
        if (!this.currentUser) return false;
        const calendar = this.getUserCalendar();
        calendar[day] = true;
        this.saveCalendar(calendar);
        return true;
    }

    getCheckedInDays() {
        const calendar = this.getUserCalendar();
        return Object.keys(calendar).filter(day => calendar[day]).length;
    }

    getUserStats() {
        if (!this.currentUser) return null;
        const key = `stats_${this.currentUser.id}`;
        return JSON.parse(localStorage.getItem(key) || '{"pushups": 0, "squats": 0, "planks": 0}');
    }

    saveUserStats(stats) {
        if (!this.currentUser) return;
        const key = `stats_${this.currentUser.id}`;
        localStorage.setItem(key, JSON.stringify(stats));
    }

    addExerciseCount(exercise, count) {
        if (!this.currentUser) return;
        const stats = this.getUserStats();
        if (exercise === 'pushups') {
            stats.pushups += count;
        } else if (exercise === 'squats') {
            stats.squats += count;
        } else if (exercise === 'planks') {
            // For planks, store in seconds
            stats.planks += count;
        }
        this.saveUserStats(stats);
    }

    resetCalendar() {
        if (!this.currentUser) return false;
        const key = `calendar_${this.currentUser.id}`;
        localStorage.setItem(key, JSON.stringify({}));
        return true;
    }
}

// Main Application
class FitnessTrainer {
    constructor() {
        // Authentication
        this.auth = new AuthSystem();
        
        // MediaPipe Pose instance
        this.pose = null;
        this.camera = null;
        
        // Canvas and video elements
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // UI elements
        this.counterEl = document.getElementById('counter');
        this.statusEl = document.getElementById('status');
        this.feedbackEl = document.getElementById('feedback');
        this.handsStatusEl = document.getElementById('hands-status');
        this.exerciseLabelEl = document.getElementById('exercise-label');
        this.errorMessage = document.getElementById('camera-error');
        
        // Control buttons
        this.startBtn = document.getElementById('start-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.resetBtn = document.getElementById('reset-btn');
        
        // Navigation elements
        this.loginBtn = document.getElementById('login-btn');
        this.menuBtn = document.getElementById('menu-btn');
        this.sideMenu = document.getElementById('side-menu');
        this.menuCalendar = document.getElementById('menu-calendar');
        this.menuExercises = document.getElementById('menu-exercises');
        this.menuAccount = document.getElementById('menu-account');
        this.loginModal = document.getElementById('login-modal');
        this.closeLoginModal = document.getElementById('close-login-modal');
        this.submitLogin = document.getElementById('submit-login');
        this.submitRegister = document.getElementById('submit-register');
        this.switchToRegister = document.getElementById('switch-to-register');
        this.switchToLogin = document.getElementById('switch-to-login');
        this.loginForm = document.getElementById('login-form');
        this.registerForm = document.getElementById('register-form');
        this.accessLoginBtn = document.getElementById('access-login-btn');
        
        // Views
        this.exerciseView = document.getElementById('exercise-view');
        this.calendarView = document.getElementById('calendar-view');
        this.exerciseSelectionView = document.getElementById('exercise-selection-view');
        this.accountView = document.getElementById('account-view');
        this.accessDeniedView = document.getElementById('access-denied');
        
        // State
        this.isRunning = false;
        this.isPaused = false;
        this.pushUpCount = 0;
        this.pushUpState = 'UP'; // 'UP' or 'DOWN'
        this.currentExercise = 'pushups';
        
        // Plank timer state
        this.plankStartTime = null;
        this.plankElapsedTime = 0;
        this.plankPauseTime = 0; // Total paused time
        this.plankLastPauseStart = null;
        this.plankTimerInterval = null;
        this.plankFormValid = false; // Track if plank form is currently valid
        this.plankTimeSaved = false; // Track if current session time has been saved
        
        // Squat state
        this.squatCount = 0;
        this.squatState = 'UP'; // 'UP' or 'DOWN'
        this.baselineHipYSquat = null;
        
        // Pose tracking data (smoothed)
        this.previousPoseData = null;
        this.smoothingFactor = 0.7;
        
        // State tracking for push-up detection
        this.baselineShoulderY = null;
        this.baselineHipY = null;
        
        // Push-up detection thresholds
        this.ELBOW_ANGLE_THRESHOLD = 120; // degrees (lower = more bent, 90 = fully bent)
        this.SHOULDER_MOVEMENT_THRESHOLD = 0.03; // normalized (3% of frame height)
        this.SYMMETRY_THRESHOLD = 15; // degrees difference between arms
        this.MIN_SHOULDER_DROP = 0.02; // Minimum downward movement (2% of frame)
        
        // Squat detection thresholds
        this.SQUAT_KNEE_ANGLE_THRESHOLD = 120; // degrees (lower = more bent)
        this.SQUAT_HIP_DROP_THRESHOLD = 0.15; // 15% of frame height
        
        // Exercise configurations
        this.exercises = {
            pushups: { name: 'Push-ups', label: 'Push-ups' },
            squats: { name: 'Squats', label: 'Squats' },
            planks: { name: 'Planks', label: 'Planks' }
        };
        
        // Bind methods
        this.init();
    }
    
    async init() {
        // Set up authentication UI
        this.setupAuth();
        
        // Set up navigation
        this.setupNavigation();
        
        // Set up exercise selection
        this.setupExerciseSelection();
        
        // Set up button handlers
        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.resetBtn.addEventListener('click', () => this.reset());
        
        // Initialize exercise label
        this.exerciseLabelEl.textContent = this.exercises[this.currentExercise].label;
        
        // Set initial counter section style
        const counterSection = document.querySelector('.counter-section');
        if (this.currentExercise === 'planks') {
            counterSection.classList.add('plank-mode');
        } else {
            counterSection.classList.remove('plank-mode');
        }
        
        // Check if user is logged in
        if (this.auth.isAuthenticated()) {
            this.showExerciseView();
        } else {
            this.showExerciseView(); // Show exercise view but require login for other features
        }
        
        // Initialize camera
        await this.setupCamera();
        
        // Initialize MediaPipe Pose after camera is ready
        this.pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });
        
        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        // Set up pose detection callback
        this.pose.onResults(this.onPoseResults.bind(this));
    }

    setupAuth() {
        this.loginBtn.addEventListener('click', () => this.openLoginModal());
        this.closeLoginModal.addEventListener('click', () => this.closeLoginModalFunc());
        this.accessLoginBtn.addEventListener('click', () => this.openLoginModal());
        
        // Close modal when clicking outside
        this.loginModal.addEventListener('click', (e) => {
            if (e.target === this.loginModal) {
                this.closeLoginModalFunc();
            }
        });
        
        this.submitLogin.addEventListener('click', () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const result = this.auth.login(email, password);
            if (result.success) {
                this.closeLoginModalFunc();
                this.updateUI();
            } else {
                alert(result.message);
            }
        });
        
        this.submitRegister.addEventListener('click', () => {
            const name = document.getElementById('register-name').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            const result = this.auth.register(name, email, password);
            if (result.success) {
                this.closeLoginModalFunc();
                this.updateUI();
            } else {
                alert(result.message);
            }
        });
        
        this.switchToRegister.addEventListener('click', (e) => {
            e.preventDefault();
            this.loginForm.classList.add('hidden');
            this.registerForm.classList.remove('hidden');
        });
        
        this.switchToLogin.addEventListener('click', (e) => {
            e.preventDefault();
            this.registerForm.classList.add('hidden');
            this.loginForm.classList.remove('hidden');
        });
        
        // Update UI on load
        this.updateUI();
    }

    updateUI() {
        if (this.auth.isAuthenticated()) {
            this.loginBtn.textContent = `Logout (${this.auth.currentUser.name})`;
            this.loginBtn.onclick = () => {
                this.auth.logout();
                this.updateUI();
                this.showExerciseView();
            };
        } else {
            this.loginBtn.textContent = 'Login / Register';
            this.loginBtn.onclick = () => this.openLoginModal();
        }
    }

    openLoginModal() {
        this.loginModal.classList.remove('hidden');
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('register-name').value = '';
        document.getElementById('register-email').value = '';
        document.getElementById('register-password').value = '';
        this.loginForm.classList.remove('hidden');
        this.registerForm.classList.add('hidden');
    }

    closeLoginModalFunc() {
        this.loginModal.classList.add('hidden');
    }

    setupNavigation() {
        this.menuBtn.addEventListener('click', () => {
            this.sideMenu.classList.toggle('hidden');
        });

        this.menuCalendar.addEventListener('click', () => {
            this.showCalendar();
            this.sideMenu.classList.add('hidden');
        });

        this.menuExercises.addEventListener('click', () => {
            this.showExerciseSelection();
            this.sideMenu.classList.add('hidden');
        });

        this.menuAccount.addEventListener('click', () => {
            this.showAccount();
            this.sideMenu.classList.add('hidden');
        });

        // Close menu when clicking overlay
        document.querySelector('.menu-overlay').addEventListener('click', () => {
            this.sideMenu.classList.add('hidden');
        });
    }

    setupExerciseSelection() {
        const exerciseCards = document.querySelectorAll('.exercise-card');
        exerciseCards.forEach(card => {
            card.addEventListener('click', () => {
                const exercise = card.dataset.exercise;
                this.currentExercise = exercise;
                this.exerciseLabelEl.textContent = this.exercises[exercise].label;
                this.reset();
                this.showExerciseView();
                
                // Stop plank timer if switching exercises
                if (exercise !== 'planks') {
                    this.stopPlankTimer();
                }
                
                // Update counter section style for planks
                const counterSection = document.querySelector('.counter-section');
                if (exercise === 'planks') {
                    counterSection.classList.add('plank-mode');
                } else {
                    counterSection.classList.remove('plank-mode');
                }
            });
        });
    }

    showExerciseView() {
        this.hideAllViews();
        this.exerciseView.classList.remove('hidden');
    }

    showCalendar() {
        if (!this.auth.isAuthenticated()) {
            this.showAccessDenied();
            return;
        }

        this.hideAllViews();
        this.calendarView.classList.remove('hidden');
        this.renderCalendar();
    }

    showExerciseSelection() {
        if (!this.auth.isAuthenticated()) {
            this.showAccessDenied();
            return;
        }

        this.hideAllViews();
        this.exerciseSelectionView.classList.remove('hidden');
    }

    showAccount() {
        if (!this.auth.isAuthenticated()) {
            this.showAccessDenied();
            return;
        }

        this.hideAllViews();
        this.accountView.classList.remove('hidden');
        this.renderAccount();
    }

    renderAccount() {
        if (!this.auth.currentUser) return;

        document.getElementById('account-name').textContent = this.auth.currentUser.name;
        document.getElementById('account-email').textContent = this.auth.currentUser.email;

        const stats = this.auth.getUserStats();
        document.getElementById('stat-pushups').textContent = stats.pushups || 0;
        document.getElementById('stat-squats').textContent = stats.squats || 0;
        
        // Format plank time (total seconds)
        const plankSeconds = Math.floor(stats.planks || 0);
        const hours = Math.floor(plankSeconds / 3600);
        const minutes = Math.floor((plankSeconds % 3600) / 60);
        const seconds = plankSeconds % 60;
        
        if (hours > 0) {
            document.getElementById('stat-planks').textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
            document.getElementById('stat-planks').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    }

    showAccessDenied() {
        this.hideAllViews();
        this.accessDeniedView.classList.remove('hidden');
    }

    hideAllViews() {
        this.exerciseView.classList.add('hidden');
        this.calendarView.classList.add('hidden');
        this.exerciseSelectionView.classList.add('hidden');
        this.accountView.classList.add('hidden');
        this.accessDeniedView.classList.add('hidden');
    }

    renderCalendar() {
        const calendarGrid = document.getElementById('calendar-grid');
        const calendar = this.auth.getUserCalendar();
        const checkedInDays = this.auth.getCheckedInDays();
        const congratulations = document.getElementById('congratulations');
        
        calendarGrid.innerHTML = '';
        
        if (checkedInDays >= 30) {
            congratulations.classList.remove('hidden');
            // Set up start over button
            const startOverBtn = document.getElementById('start-over-btn');
            if (startOverBtn) {
                startOverBtn.onclick = () => {
                    if (confirm('Are you sure you want to start over? This will reset your 30-day calendar.')) {
                        this.auth.resetCalendar();
                        this.renderCalendar();
                    }
                };
            }
            return;
        } else {
            congratulations.classList.add('hidden');
        }
        
        for (let day = 1; day <= 30; day++) {
            const dayElement = document.createElement('div');
            dayElement.className = 'calendar-day';
            
            if (calendar[day]) {
                dayElement.classList.add('checked-in');
                dayElement.innerHTML = `<span>✓</span><br>Day ${day}`;
            } else {
                dayElement.classList.add('not-checked-in');
                const dayNumber = document.createElement('div');
                dayNumber.textContent = `Day ${day}`;
                dayNumber.style.marginBottom = '10px';
                dayNumber.style.fontWeight = '600';
                dayElement.appendChild(dayNumber);
                
                const checkInBtn = document.createElement('button');
                checkInBtn.textContent = 'Check In';
                checkInBtn.className = 'check-in-btn';
                checkInBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Only allow checking in if previous day is checked or it's day 1
                    if (day === 1 || calendar[day - 1]) {
                        this.auth.checkIn(day);
                        this.renderCalendar();
                    } else {
                        alert('Please check in for previous days first!');
                    }
                });
                dayElement.appendChild(checkInBtn);
            }
            
            calendarGrid.appendChild(dayElement);
        }
    }
    
    async setupCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            this.video.srcObject = stream;
            this.video.onloadedmetadata = () => {
                this.canvas.width = this.video.videoWidth;
                this.canvas.height = this.video.videoHeight;
            };
            
            this.errorMessage.classList.add('hidden');
        } catch (error) {
            console.error('Camera access error:', error);
            this.errorMessage.classList.remove('hidden');
        }
    }
    
    start() {
        if (!this.pose || !this.video.srcObject) {
            alert('Camera not available');
            return;
        }
        
        this.isRunning = true;
        this.isPaused = false;
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        
        // For planks, timer will start when correct form is detected
        if (this.currentExercise === 'planks') {
            // Don't start timer yet - wait for correct form
            this.plankFormValid = false;
        }
        
        // Start processing loop
        this.processVideo();
    }
    
    startPlankTimer() {
        // Start interval if not already running
        if (this.plankTimerInterval) return;
        
        this.plankTimerInterval = setInterval(() => {
            if (!this.isPaused && this.isRunning) {
                if (this.plankFormValid && this.plankStartTime !== null) {
                    // Only count time when form is valid and start time is set
                    const now = Date.now();
                    this.plankElapsedTime = now - this.plankStartTime - this.plankPauseTime;
                }
                // Always update display
                this.updatePlankDisplay();
            }
        }, 100); // Update every 100ms for smooth display
    }
    
    stopPlankTimerCounting() {
        // Pause the timer counting (but keep interval running for display)
        if (this.plankLastPauseStart === null && this.plankStartTime !== null) {
            this.plankLastPauseStart = Date.now();
        }
    }
    
    resumePlankTimerCounting() {
        // Resume the timer counting
        if (this.plankLastPauseStart !== null) {
            const pauseDuration = Date.now() - this.plankLastPauseStart;
            this.plankPauseTime += pauseDuration;
            this.plankLastPauseStart = null;
        }
    }
    
    stopPlankTimer() {
        if (this.plankTimerInterval) {
            clearInterval(this.plankTimerInterval);
            this.plankTimerInterval = null;
        }
    }
    
    updatePlankDisplay() {
        const totalSeconds = Math.floor(this.plankElapsedTime / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const milliseconds = Math.floor((this.plankElapsedTime % 1000) / 100);
        
        // Format as MM:SS.ms (stopwatch style)
        this.counterEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${milliseconds}`;
    }
    
    savePlankTime() {
        // Save plank time when session ends (pause, stop, or reset)
        // Only save if we haven't already saved this session's time
        if (this.auth.isAuthenticated() && this.plankElapsedTime > 0 && this.currentExercise === 'planks' && !this.plankTimeSaved) {
            const totalSecondsFloat = this.plankElapsedTime / 1000;
            const stats = this.auth.getUserStats();
            // Add to existing total
            stats.planks = (stats.planks || 0) + totalSecondsFloat;
            this.auth.saveUserStats(stats);
            this.plankTimeSaved = true;
        }
    }
    
    async processVideo() {
        if (!this.isRunning) {
            // Stop plank timer when not running and save time
            if (this.currentExercise === 'planks') {
                this.savePlankTime();
                this.stopPlankTimer();
                this.plankFormValid = false;
            }
            return;
        }
        
        if (!this.isPaused && this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            await this.pose.send({ image: this.video });
        }
        
        // Continue processing
        requestAnimationFrame(() => this.processVideo());
    }
    
    pause() {
        this.isPaused = !this.isPaused;
        this.pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
        
        // Handle plank timer pause/resume
        if (this.currentExercise === 'planks') {
            if (this.isPaused) {
                // Pause timer counting
                if (this.plankLastPauseStart === null && this.plankStartTime !== null) {
                    this.plankLastPauseStart = Date.now();
                }
            } else {
                // Resume timer if form is valid
                if (this.plankFormValid) {
                    this.resumePlankTimerCounting();
                    if (!this.plankTimerInterval) {
                        this.startPlankTimer();
                    }
                }
            }
        }
    }
    
    reset() {
        // Save plank time before resetting
        if (this.currentExercise === 'planks') {
            this.savePlankTime();
        }
        
        this.pushUpCount = 0;
        this.pushUpState = 'UP';
        this.squatCount = 0;
        this.squatState = 'UP';
        this.plankStartTime = null;
        this.plankElapsedTime = 0;
        this.plankPauseTime = 0;
        this.plankLastPauseStart = null;
        this.plankFormValid = false;
        this.plankTimeSaved = false;
        this.stopPlankTimer();
        
        if (this.currentExercise === 'planks') {
            this.counterEl.textContent = '00:00.0';
        } else {
            this.counterEl.textContent = '0';
        }
        
        this.statusEl.textContent = '';
        this.statusEl.className = 'status';
        this.feedbackEl.textContent = '';
        this.handsStatusEl.textContent = '';
        this.previousPoseData = null;
        this.baselineShoulderY = null;
        this.baselineHipY = null;
        this.baselineHipYSquat = null;
    }
    
    onPoseResults(results) {
        // Clear canvas
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        
        if (!results.poseLandmarks) {
            this.updateStatus('', '');
            this.handsStatusEl.textContent = '';
            return;
        }
        
        // Smooth pose data
        const smoothedLandmarks = this.smoothPoseData(results.poseLandmarks);
        
        // Draw skeleton
        this.drawSkeleton(smoothedLandmarks);
        
        // Analyze based on exercise type
        if (this.currentExercise === 'pushups') {
            const analysis = this.analyzePushUp(smoothedLandmarks);
            
            // Update state machine and count
            this.updatePushUpState(analysis);
            
            // Provide feedback
            this.provideFeedback(analysis);
            
            // Check if hands are on the floor
            const handsCheck = this.checkHandsOnFloor(smoothedLandmarks);
            if (handsCheck.handsOnFloor) {
                this.handsStatusEl.textContent = '✓ Hands on floor';
                this.handsStatusEl.className = 'hands-status on-floor';
            } else {
                this.handsStatusEl.textContent = '✗ Hands not on floor';
                this.handsStatusEl.className = 'hands-status not-on-floor';
            }
        } else if (this.currentExercise === 'squats') {
            const analysis = this.analyzeSquat(smoothedLandmarks);
            
            // Update state machine and count
            this.updateSquatState(analysis);
            
            // Provide feedback
            this.provideFeedback(analysis);
            
            this.handsStatusEl.textContent = '';
        } else if (this.currentExercise === 'planks') {
            const analysis = this.analyzePlank(smoothedLandmarks);
            this.provideFeedback(analysis);
            
            // Control timer based on plank form validity
            const wasValid = this.plankFormValid;
            this.plankFormValid = analysis.isValid === true;
            
            // Ensure timer interval is running when exercise is running
            if (this.isRunning && !this.isPaused && !this.plankTimerInterval) {
                this.startPlankTimer();
            }
            
            // Start/resume timer counting when form becomes valid
            if (this.plankFormValid && !wasValid && this.isRunning && !this.isPaused) {
                // Initialize start time when first valid form detected
                if (this.plankStartTime === null) {
                    this.plankStartTime = Date.now();
                    this.plankPauseTime = 0;
                    this.plankTimeSaved = false; // Reset saved flag when starting new session
                } else {
                    // Resume counting if we were paused
                    this.resumePlankTimerCounting();
                }
            }
            
            // Stop timer counting when form becomes invalid
            if (!this.plankFormValid && wasValid && this.isRunning && !this.isPaused) {
                this.stopPlankTimerCounting();
            }
            
            // Check if hands are on the floor
            const handsCheck = this.checkHandsOnFloor(smoothedLandmarks);
            if (handsCheck.handsOnFloor) {
                this.handsStatusEl.textContent = '✓ Hands on floor';
                this.handsStatusEl.className = 'hands-status on-floor';
            } else {
                this.handsStatusEl.textContent = '✗ Hands not on floor';
                this.handsStatusEl.className = 'hands-status not-on-floor';
            }
        } else {
            // For other exercises, just check hands on floor
            const handsCheck = this.checkHandsOnFloor(smoothedLandmarks);
            this.provideFeedback(handsCheck);
            if (handsCheck.handsOnFloor) {
                this.handsStatusEl.textContent = '✓ Hands on floor';
                this.handsStatusEl.className = 'hands-status on-floor';
            } else {
                this.handsStatusEl.textContent = '✗ Hands not on floor';
                this.handsStatusEl.className = 'hands-status not-on-floor';
            }
        }
    }
    
    smoothPoseData(landmarks) {
        if (!this.previousPoseData) {
            this.previousPoseData = landmarks.map(lm => ({ ...lm }));
            return landmarks;
        }
        
        return landmarks.map((lm, i) => {
            const prev = this.previousPoseData[i];
            return {
                x: lm.x * (1 - this.smoothingFactor) + prev.x * this.smoothingFactor,
                y: lm.y * (1 - this.smoothingFactor) + prev.y * this.smoothingFactor,
                z: lm.z * (1 - this.smoothingFactor) + prev.z * this.smoothingFactor,
                visibility: lm.visibility
            };
        });
    }
    
    drawSkeleton(landmarks) {
        // Define connections for skeleton
        const connections = [
            [11, 12], // shoulders
            [11, 13], [13, 15], // left arm
            [12, 14], [14, 16], // right arm
            [11, 23], [12, 24], // shoulders to hips
            [23, 24], // hips
            [23, 25], [24, 26], // hips to knees
            [0, 2], [0, 5], // head
        ];
        
        // Determine skeleton color based on form feedback
        const hasStatus = this.statusEl.textContent !== '';
        const isCorrect = this.statusEl.classList.contains('correct');
        let skeletonColor = '#4ecdc4'; // Default cyan
        let jointColor = '#ffffff';
        
        if (hasStatus && this.isRunning && !this.isPaused) {
            skeletonColor = isCorrect ? '#51cf66' : '#ff6b6b';
            jointColor = isCorrect ? '#6bcf51' : '#ff8787';
        }
        
        // Draw connections
        this.ctx.strokeStyle = skeletonColor;
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = skeletonColor;
        
        connections.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];
            
            if (startPoint.visibility > 0.5 && endPoint.visibility > 0.5) {
                this.ctx.beginPath();
                this.ctx.moveTo(
                    startPoint.x * this.canvas.width,
                    startPoint.y * this.canvas.height
                );
                this.ctx.lineTo(
                    endPoint.x * this.canvas.width,
                    endPoint.y * this.canvas.height
                );
                this.ctx.stroke();
            }
        });
        
        // Draw joints (key points)
        const keyPoints = [11, 12, 13, 14, 15, 16, 23, 24]; // shoulders, elbows, wrists, hips
        this.ctx.shadowBlur = 10;
        
        keyPoints.forEach(index => {
            const point = landmarks[index];
            if (point.visibility > 0.5) {
                this.ctx.fillStyle = jointColor;
                this.ctx.beginPath();
                this.ctx.arc(
                    point.x * this.canvas.width,
                    point.y * this.canvas.height,
                    8,
                    0,
                    2 * Math.PI
                );
                this.ctx.fill();
                
                // Inner highlight
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.arc(
                    point.x * this.canvas.width,
                    point.y * this.canvas.height,
                    4,
                    0,
                    2 * Math.PI
                );
                this.ctx.fill();
            }
        });
        
        // Reset shadow
        this.ctx.shadowBlur = 0;
        
        // Store current pose for smoothing
        this.previousPoseData = landmarks.map(lm => ({ ...lm }));
    }
    
    analyzePushUp(landmarks) {
        // Get key landmarks
        // MediaPipe Pose landmark indices:
        // 11: left shoulder, 12: right shoulder
        // 13: left elbow, 14: right elbow
        // 15: left wrist, 16: right wrist
        // 23: left hip, 24: right hip
        
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftElbow = landmarks[13];
        const rightElbow = landmarks[14];
        const leftWrist = landmarks[15];
        const rightWrist = landmarks[16];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        
        // Check visibility
        const allVisible = 
            leftShoulder.visibility > 0.5 &&
            rightShoulder.visibility > 0.5 &&
            leftElbow.visibility > 0.5 &&
            rightElbow.visibility > 0.5 &&
            leftWrist.visibility > 0.5 &&
            rightWrist.visibility > 0.5;
        
        if (!allVisible) {
            return { isValid: false, reason: 'Not all body parts visible' };
        }
        
        // Calculate elbow angles
        const leftAngle = this.calculateAngle(leftShoulder, leftElbow, leftWrist);
        const rightAngle = this.calculateAngle(rightShoulder, rightElbow, rightWrist);
        
        // Calculate shoulder movement (vertical distance from hips)
        const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
        const avgHipY = (leftHip.y + rightHip.y) / 2;
        const shoulderHeight = Math.abs(avgShoulderY - avgHipY);
        
        // Calculate symmetry (difference in elbow angles)
        const angleDifference = Math.abs(leftAngle - rightAngle);
        
        // Calculate body alignment (shoulder level)
        const shoulderLevel = Math.abs(leftShoulder.y - rightShoulder.y);
        const hipLevel = Math.abs(leftHip.y - rightHip.y);
        const bodyTilt = Math.max(shoulderLevel, hipLevel);
        
        // Check if angles are valid (elbows bent enough)
        const bothArmsBent = leftAngle < this.ELBOW_ANGLE_THRESHOLD && 
                            rightAngle < this.ELBOW_ANGLE_THRESHOLD;
        
        // Check symmetry
        const isSymmetric = angleDifference < this.SYMMETRY_THRESHOLD;
        
        // Check body alignment (no excessive tilt)
        const isAligned = bodyTilt < 0.03; // 3% of frame height
        
        // Determine if push-up is correct
        let isValid = false;
        let reason = '';
        
        // Check if shoulders are above hips (proper push-up position)
        const shoulderToHipDistance = avgShoulderY - avgHipY;
        const shouldersAboveHips = shoulderToHipDistance < 0; // Negative means shoulders are above (smaller Y)
        
        // Establish baseline on first valid frame when in UP position (arms straight or starting)
        if (this.baselineShoulderY === null && shouldersAboveHips && isAligned) {
            // Only set baseline if arms are not fully bent (starting position)
            const avgAngle = (leftAngle + rightAngle) / 2;
            if (avgAngle > 140) { // Arms mostly straight
                this.baselineShoulderY = avgShoulderY;
                this.baselineHipY = avgHipY;
            }
        }
        
        // Phase-aware validation: different rules for UP vs DOWN phase
        const avgAngle = (leftAngle + rightAngle) / 2;
        const isInDownPhase = this.pushUpState === 'DOWN';
        
        // Validation checks in priority order
        if (!shouldersAboveHips) {
            reason = 'Keep your body higher';
        } else if (!isAligned) {
            reason = 'Keep your body straight';
        } else if (!isSymmetric) {
            reason = 'Work with both arms symmetrically';
        } else if (isInDownPhase && !bothArmsBent) {
            // During DOWN phase, we require arms to be bent
            reason = 'Bend your arms more';
        } else if (!isInDownPhase && avgAngle < 100) {
            // During UP phase, if arms are still very bent, it's incomplete
            reason = 'Straighten your arms completely';
        } else {
            // All form checks passed - valid push-up
            isValid = true;
        }
        
        return {
            isValid,
            reason: isValid ? '' : reason,
            leftAngle,
            rightAngle,
            angleDifference,
            shoulderHeight,
            bodyTilt,
            avgShoulderY,
            avgHipY,
            shouldersAboveHips,
            isAligned
        };
    }
    
    calculateAngle(point1, point2, point3) {
        // Calculate angle at point2 (the middle point)
        const vector1 = {
            x: point1.x - point2.x,
            y: point1.y - point2.y
        };
        const vector2 = {
            x: point3.x - point2.x,
            y: point3.y - point2.y
        };
        
        const dotProduct = vector1.x * vector2.x + vector1.y * vector2.y;
        const magnitude1 = Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y);
        const magnitude2 = Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y);
        
        const cosAngle = dotProduct / (magnitude1 * magnitude2);
        const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
        
        return angle;
    }
    
    updatePushUpState(analysis) {
        // Don't update state if we don't have valid pose data
        if (!analysis) {
            return;
        }
        
        const { avgShoulderY, avgHipY, leftAngle, rightAngle, shouldersAboveHips, isAligned } = analysis;
        
        // Use baseline for state detection if available
        if (this.baselineShoulderY === null) {
            return; // Wait for baseline
        }
        
        // Basic safety check - must have shoulders above hips and body aligned
        if (!shouldersAboveHips || !isAligned) {
            return;
        }
        
        const shoulderMovement = avgShoulderY - this.baselineShoulderY;
        const avgAngle = (leftAngle + rightAngle) / 2;
        const downThreshold = this.MIN_SHOULDER_DROP * 2; // Require significant movement to count as down
        const upThreshold = this.MIN_SHOULDER_DROP * 0.5; // Threshold to return to up
        
        // State machine logic
        if (this.pushUpState === 'UP') {
            // Transition to DOWN when:
            // 1. Shoulders have moved down significantly, AND
            // 2. Arms are bent (angle decreased - during down phase we expect bending)
            if (shoulderMovement > downThreshold && avgAngle < this.ELBOW_ANGLE_THRESHOLD) {
                this.pushUpState = 'DOWN';
            }
        } else if (this.pushUpState === 'DOWN') {
            // Transition to UP when:
            // 1. Shoulders have moved back up close to baseline, AND
            // 2. Arms are returning to straighter position (angles increasing)
            if (shoulderMovement < upThreshold && avgAngle > 110) {
                this.pushUpState = 'UP';
                this.pushUpCount++;
                this.counterEl.textContent = this.pushUpCount;
                
                // Save to user stats
                if (this.auth.isAuthenticated()) {
                    this.auth.addExerciseCount('pushups', 1);
                }
                
                // Update baseline for next repetition (use current position as new baseline)
                this.baselineShoulderY = avgShoulderY;
                this.baselineHipY = avgHipY;
                
                // Celebration animation
                this.counterEl.style.transition = 'transform 0.2s ease';
                this.counterEl.style.transform = 'scale(1.3)';
                setTimeout(() => {
                    this.counterEl.style.transform = 'scale(1)';
                }, 200);
            }
        }
    }
    
    analyzeSquat(landmarks) {
        // MediaPipe Pose landmark indices:
        // 23: left hip, 24: right hip
        // 25: left knee, 26: right knee
        // 27: left ankle, 28: right ankle
        
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftKnee = landmarks[25];
        const rightKnee = landmarks[26];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];
        
        // Check visibility
        const allVisible = 
            leftHip.visibility > 0.5 &&
            rightHip.visibility > 0.5 &&
            leftKnee.visibility > 0.5 &&
            rightKnee.visibility > 0.5 &&
            leftAnkle.visibility > 0.5 &&
            rightAnkle.visibility > 0.5;
        
        if (!allVisible) {
            return { isValid: false, reason: 'Not all body parts visible' };
        }
        
        // Calculate knee angles
        const leftKneeAngle = this.calculateAngle(leftHip, leftKnee, leftAnkle);
        const rightKneeAngle = this.calculateAngle(rightHip, rightKnee, rightAnkle);
        
        // Calculate average hip Y position
        const avgHipY = (leftHip.y + rightHip.y) / 2;
        
        // Establish baseline on first valid frame when standing
        if (this.baselineHipYSquat === null) {
            const avgAngle = (leftKneeAngle + rightKneeAngle) / 2;
            if (avgAngle > 150) { // Legs mostly straight (standing)
                this.baselineHipYSquat = avgHipY;
            }
        }
        
        // Calculate angles and symmetry
        const avgAngle = (leftKneeAngle + rightKneeAngle) / 2;
        const angleDifference = Math.abs(leftKneeAngle - rightKneeAngle);
        const isSymmetric = angleDifference < 20; // degrees
        
        // Determine if squat is correct
        let isValid = false;
        let reason = '';
        
        if (this.baselineHipYSquat === null) {
            reason = 'Stand up straight to start';
        } else if (!isSymmetric) {
            reason = 'Keep both legs balanced';
        } else if (avgAngle < this.SQUAT_KNEE_ANGLE_THRESHOLD) {
            // Legs are bent enough for a squat
            const hipDrop = avgHipY - this.baselineHipYSquat;
            if (hipDrop > this.SQUAT_HIP_DROP_THRESHOLD) {
                isValid = true;
            } else {
                reason = 'Go lower';
            }
        } else if (avgAngle > 150) {
            // Legs are straight (standing position)
            isValid = true;
        } else {
            reason = 'Position yourself in view';
        }
        
        return {
            isValid,
            reason: isValid ? '' : reason,
            leftKneeAngle,
            rightKneeAngle,
            avgAngle,
            avgHipY,
            isSymmetric
        };
    }
    
    updateSquatState(analysis) {
        if (!analysis || this.baselineHipYSquat === null) {
            return;
        }
        
        const { avgAngle } = analysis;
        
        // State machine logic for squats
        if (this.squatState === 'UP') {
            // Transition to DOWN when knees are bent significantly
            if (avgAngle < this.SQUAT_KNEE_ANGLE_THRESHOLD) {
                this.squatState = 'DOWN';
            }
        } else if (this.squatState === 'DOWN') {
            // Transition to UP when returning to standing
            if (avgAngle > 150) {
                this.squatState = 'UP';
                this.squatCount++;
                this.counterEl.textContent = this.squatCount;
                
                // Save to user stats
                if (this.auth.isAuthenticated()) {
                    this.auth.addExerciseCount('squats', 1);
                }
                
                // Celebration animation
                this.counterEl.style.transition = 'transform 0.2s ease';
                this.counterEl.style.transform = 'scale(1.3)';
                setTimeout(() => {
                    this.counterEl.style.transform = 'scale(1)';
                }, 200);
            }
        }
    }
    
    analyzePlank(landmarks) {
        // For planks, we want to check if the body is straight and horizontal
        // MediaPipe Pose landmark indices:
        // 11: left shoulder, 12: right shoulder
        // 23: left hip, 24: right hip
        // 27: left ankle, 28: right ankle
        
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];
        
        // Check visibility
        const allVisible = 
            leftShoulder.visibility > 0.5 &&
            rightShoulder.visibility > 0.5 &&
            leftHip.visibility > 0.5 &&
            rightHip.visibility > 0.5;
        
        if (!allVisible) {
            return { isValid: false, reason: 'Position yourself in view' };
        }
        
        // Calculate body alignment (shoulder and hip level)
        const shoulderLevel = Math.abs(leftShoulder.y - rightShoulder.y);
        const hipLevel = Math.abs(leftHip.y - rightHip.y);
        const bodyTilt = Math.max(shoulderLevel, hipLevel);
        
        // Check if body is straight (low tilt)
        const isAligned = bodyTilt < 0.03; // 3% of frame height
        
        // Calculate if body is relatively horizontal (hips not too much higher/lower than shoulders)
        const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
        const avgHipY = (leftHip.y + rightHip.y) / 2;
        const verticalDiff = Math.abs(avgShoulderY - avgHipY);
        const isHorizontal = verticalDiff < 0.2; // Allow some variation
        
        let isValid = false;
        let reason = '';
        
        if (!isAligned) {
            reason = 'Keep your body straight';
        } else if (!isHorizontal) {
            reason = 'Keep your body horizontal';
        } else {
            isValid = true;
        }
        
        return {
            isValid,
            reason: isValid ? '' : reason,
            bodyTilt,
            isAligned,
            isHorizontal
        };
    }
    
    checkHandsOnFloor(landmarks) {
        // MediaPipe Pose landmark indices:
        // 15: left wrist, 16: right wrist
        // 23: left hip, 24: right hip
        // 27: left ankle, 28: right ankle
        
        const leftWrist = landmarks[15];
        const rightWrist = landmarks[16];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const leftAnkle = landmarks[27];
        const rightAnkle = landmarks[28];
        
        // Check visibility
        const wristsVisible = leftWrist.visibility > 0.5 && rightWrist.visibility > 0.5;
        
        if (!wristsVisible) {
            return { handsOnFloor: false, reason: 'Wrists not visible' };
        }
        
        // Calculate average positions
        const avgWristY = (leftWrist.y + rightWrist.y) / 2;
        const avgHipY = (leftHip.y + rightHip.y) / 2;
        const avgAnkleY = leftAnkle.visibility > 0.5 && rightAnkle.visibility > 0.5 
            ? (leftAnkle.y + rightAnkle.y) / 2 
            : avgHipY + 0.3; // Fallback if ankles not visible
        
        // Hands are on floor if wrists are at or below hip/ankle level
        // We use a threshold: wrists should be at least at hip level or lower
        const threshold = avgHipY + 0.15; // Allow some tolerance (15% of frame height)
        const handsOnFloor = avgWristY >= threshold;
        
        return {
            handsOnFloor,
            reason: handsOnFloor ? 'Hands detected on floor' : 'Raise your hands'
        };
    }
    
    provideFeedback(analysis) {
        if (!analysis) {
            this.updateStatus('', '');
            return;
        }
        
        if (analysis.isValid !== undefined) {
            // Push-up analysis feedback
            if (analysis.isValid) {
                this.updateStatus('Correct', 'correct');
                this.feedbackEl.textContent = '';
            } else {
                this.updateStatus('Incorrect', 'incorrect');
                this.feedbackEl.textContent = analysis.reason || '';
            }
        } else {
            // Hands check feedback (for other exercises)
            if (analysis.handsOnFloor) {
                this.updateStatus('Hands on floor ✓', 'correct');
                this.feedbackEl.textContent = '';
            } else {
                this.updateStatus('Hands not on floor', 'incorrect');
                this.feedbackEl.textContent = analysis.reason || '';
            }
        }
    }
    
    updateStatus(text, className) {
        this.statusEl.textContent = text;
        this.statusEl.className = 'status ' + (className || '');
    }
}

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new FitnessTrainer();
    });
} else {
    new FitnessTrainer();
}