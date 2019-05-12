import { Component, OnInit } from '@angular/core';
import { AuthService, UserState } from '../../service/auth.service';

@Component({
  selector: 'app-cloudland-home',
  templateUrl: './auth.component.html',
  providers: []
})
export class AuthComponent implements OnInit {
  constructor(private authService: AuthService) {}

  userState: UserState;
  cloudLandRewardPoints: number;

  ngOnInit() {
    this.getUserInfo();
  }

  getUserInfo() {
    this.authService
      .isAuthenticated()
      .subscribe(user => (this.userState = user));
  }
}
